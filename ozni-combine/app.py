from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
import os
import pickle
import uuid
import time
import numpy as np
import io
import threading
import json
import re
import traceback
from pathlib import Path
import mimetypes
import time
import traceback

from services.cvat_service import CVATService
from services.embedding_service import EmbeddingService
from services.clustering_service import ClusteringService
from models.data_models import JobStatus, EmbeddingJob, LabelUpdateRequest, AnnotationUpdateRequest, BatchUpdateResponse, LabelCreationResponse
from config import CHIP_LIMIT, DEFAULT_VISUAL_MODEL, DEFAULT_SEMANTIC_MODEL, DEFAULT_TEXT_EMBEDDING_MODEL, DEFAULT_LVLM_PROMPT
from services.label_hierarchy_service import LabelHierarchyService

app = Flask(__name__)
CORS(app, supports_credentials=True)  # Enable CORS with credentials support

# Configure Flask to ignore specific files for auto-reload
# This will prevent reloading when test_api.py changes
app.config['EXTRA_FILES'] = []  # Files to watch in addition to Python modules
app.config['DEBUG_SKIP_RELOAD_PATTERNS'] = [
    r'.*test_api\.py$',  # Ignore test_api.py
    r'.*visualization_sample\.json$',  # Ignore visualization output
    r'.*test_output/.*'  # Ignore test output directory
]

# Override Werkzeug reloader to respect our patterns
def _should_reload(filename):
    from werkzeug._reloader import _should_reload as original_should_reload
    if any(re.match(pattern, filename) for pattern in app.config.get('DEBUG_SKIP_RELOAD_PATTERNS', [])):
        return False
    return original_should_reload(filename)

# Apply the patch if in debug mode
if app.debug:
    import werkzeug._reloader
    werkzeug._reloader._should_reload = _should_reload

# Directory for storing embedding data
EMBEDDINGS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'embeddings')
os.makedirs(EMBEDDINGS_DIR, exist_ok=True)

# Add this constant with the other constants near the top of the file
AUDIO_FILES_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'audio_files')
os.makedirs(AUDIO_FILES_DIR, exist_ok=True)

# In-memory storage for jobs and results
# In production, consider using Redis or another persistent store
jobs = {}  # job_id -> JobStatus
embeddings_cache = {}  # project_id -> embedding data

# Initialize services
cvat_service = CVATService()
embedding_service = EmbeddingService()
clustering_service = ClusteringService()
label_hierarchy_service = LabelHierarchyService(cvat_service, embedding_service)

def get_embedding_file_path(project_id):
    """Get the file path for storing embeddings for a project"""
    return os.path.join(EMBEDDINGS_DIR, f"embeddings_project_{project_id}.pkl")

def save_embeddings_to_disk(project_id):
    """Save embeddings to disk for persistence"""
    if project_id in embeddings_cache:
        file_path = get_embedding_file_path(project_id)
        with open(file_path, 'wb') as f:
            pickle.dump(embeddings_cache[project_id], f)
        print(f"Saved embeddings for project {project_id} to {file_path}")
        return True
    return False

def load_embeddings_from_disk(project_id):
    """Load embeddings from disk if available"""
    file_path = get_embedding_file_path(project_id)
    if os.path.exists(file_path):
        try:
            with open(file_path, 'rb') as f:
                embeddings_cache[project_id] = pickle.load(f)
            print(f"Loaded embeddings for project {project_id} from {file_path}")
            return True
        except Exception as e:
            print(f"Error loading embeddings for project {project_id}: {e}")
    return False

@app.route('/api/projects', methods=['GET'])
def get_projects():
    """Get list of available CVAT projects"""
    try:
        projects = cvat_service.get_projects()
        return jsonify(projects)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/tasks', methods=['GET'])
def get_tasks():
    """Get tasks for a specific project"""
    project_id = request.args.get('project_id')
    if not project_id:
        return jsonify({"error": "project_id is required"}), 400

    try:
        tasks = cvat_service.get_tasks(project_id)
        return jsonify(tasks)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/annotations', methods=['GET'])
def get_annotations():
    """Get annotations for a specific task"""
    task_id = request.args.get('task_id')
    if not task_id:
        return jsonify({"error": "task_id is required"}), 400

    try:
        annotations = cvat_service.get_annotations(task_id)
        return jsonify(annotations)
    except Exception as e:
        return jsonify({"error": str(e)}), 500




@app.route('/api/embeddings/check', methods=['GET'])
def check_embeddings():
    """Check if embeddings exist for a project ID"""
    project_id = request.args.get('project_id')
    if not project_id:
        return jsonify({"error": "project_id is required"}), 400

    # Check if embeddings are in memory
    if project_id in embeddings_cache:
        return jsonify({"exists": True, "location": "memory"})

    # Check if embeddings are on disk
    file_path = get_embedding_file_path(project_id)
    if os.path.exists(file_path):
        return jsonify({"exists": True, "location": "disk"})

    return jsonify({"exists": False})

@app.route('/api/embeddings/get', methods=['POST'])
def get_embeddings():
    data = request.json

    if not data or 'project_id' not in data:
        return jsonify({"error": "project_id is required"}), 400

    project_id = data['project_id']
    recalculate = data.get('recalculate', False)

    # If not recalculating, check if embeddings are already available
    if not recalculate:
        if project_id in embeddings_cache:
            return jsonify({
                "status": "available",
                "location": "memory",
                "project_id": project_id
            })

        file_path = get_embedding_file_path(project_id)
        if os.path.exists(file_path):
            success = load_embeddings_from_disk(project_id)
            if success:
                return jsonify({
                    "status": "available",
                    "location": "disk",
                    "project_id": project_id
                })

    # Create new job with all parameters
    job_id = str(uuid.uuid4())
    job = JobStatus(
        id=job_id,
        project_id=project_id,
        status="pending",
        progress=0,
        task_ids=data['task_ids'],
        filter_criteria=data.get('filter_criteria', {}),
        feature_type=data.get('feature_type', 'both'),
        chip_limit=data.get('chip_limit', CHIP_LIMIT),
        visual_model=data.get('visual_model', DEFAULT_VISUAL_MODEL),
        semantic_model=data.get('semantic_model', DEFAULT_SEMANTIC_MODEL),
        text_embedding_model=data.get('text_embedding_model', DEFAULT_TEXT_EMBEDDING_MODEL),
        lvlm_prompt=data.get('lvlm_prompt', DEFAULT_LVLM_PROMPT)
    )

    print(f"Starting job {job_id} with parameters: {job.__dict__}")

    jobs[job_id] = job

    thread = threading.Thread(
        target=process_embedding_job,
        args=(job_id,)
    )
    thread.daemon = True
    thread.start()

    return jsonify({
        "status": "started",
        "job_id": job_id,
        "project_id": project_id,
        "progress": 0
    })

def process_embedding_job(job_id):
    """Background process to generate embeddings"""
    job = jobs[job_id]
    job.status = "processing"
    project_id = job.project_id

    try:
        # Get annotations from CVAT
        all_chips_data = []
        total_frames_to_process = 0
        processed_frames = 0
        total_annotations_to_process = 0
        start_time = time.time()

        # First count total frames with annotations to track progress
        for task_id in job.task_ids:
            task_info = cvat_service.get_task_info(task_id)
            annotations = cvat_service.get_annotations(task_id)
            total_annotations_to_process += len(annotations)
            print(f"Total annotations to process: {total_annotations_to_process}")
            # Apply filters if specified
            if job.filter_criteria:
                annotations = cvat_service.filter_annotations(
                    annotations,
                    job.filter_criteria
                )

            # Count frames that have annotations
            frames_with_annotations = set(shape['frame'] for shape in annotations)
            total_frames_to_process += len(frames_with_annotations)

        # Process each task
        for task_id in job.task_ids:
            task_info = cvat_service.get_task_info(task_id)
            annotations = cvat_service.get_annotations(task_id)


            # Apply filters if specified
            if job.filter_criteria:
                annotations = cvat_service.filter_annotations(
                    annotations,
                    job.filter_criteria
                )

            # Get unique frames that have annotations
            frames_with_annotations = set(shape['frame'] for shape in annotations)

            # Process frames with annotations
            for frame_idx in sorted(frames_with_annotations):
                frame_shapes = [shape for shape in annotations
                               if shape['frame'] == frame_idx]

                if not frame_shapes:
                    continue

                # Get frame image
                frame_data = cvat_service.get_frame(task_id, frame_idx)

                # Process chips and get embeddings - now passing all model parameters
                chips_data = embedding_service.embed_chips(
                    frame_data,
                    frame_shapes,
                    task_id,
                    project_id,
                    frame_idx,
                    visual_model=job.visual_model,
                    semantic_model=job.semantic_model,
                    text_embedding_model=job.text_embedding_model,
                    lvlm_prompt=job.lvlm_prompt
                )

                all_chips_data.extend(chips_data)
                processed_frames += 1

                try:
                    elapsed_time = time.time() - start_time
                    if len(all_chips_data) > 0:
                        chip_rate = elapsed_time / len(all_chips_data) # Seconds per chip
                    else:
                        chip_rate = 4
                    print("--------------------------------")
                    print("STATUS REPORT")
                    print(f"Processed {processed_frames} frames in {elapsed_time} seconds. Chip processing rate: {chip_rate} s/chip")
                except Exception as e:
                    print(f"Error calculating frame rate: {e}")

                if job.chip_limit > 0:
                    try:
                        print(f"Processed {len(all_chips_data)} frames of limit: {job.chip_limit}")
                        remaining_chips = job.chip_limit - len(all_chips_data)
                        print(f"Remaining chips: {remaining_chips}")
                        print(f"Time remaining: {remaining_chips * chip_rate} seconds")
                    except Exception as e:
                        print(f"Error calculating remaining chips: {e}")
                    job.progress = min(99, int(100 * len(all_chips_data) / job.chip_limit))

                    # Check if we've reached the chip limit
                    if len(all_chips_data) >= job.chip_limit:
                        break

                else:
                    try:
                        print(f"Processed {len(all_chips_data)} frames of limit: {total_annotations_to_process}")
                        remaining_chips = total_annotations_to_process - len(all_chips_data)
                        print(f"Remaining chips: {remaining_chips}")
                        print(f"Time remaining: {remaining_chips * chip_rate} seconds")
                    except Exception as e:
                        print(f"Error calculating remaining chips: {e}")
                    job.progress = min(99, int(100 * len(all_chips_data) / total_annotations_to_process))
                    if len(all_chips_data) >= total_annotations_to_process:
                        break
                print("--------------------------------")

                # Check if we've reached the chip limit


        # Prepare data for storage
        descriptions = [(filename, desc) for filename, desc, _, _ in all_chips_data]
        embeddings = embedding_service.get_selected_embeddings(all_chips_data, job.feature_type)

        # Store results in memory, indexed by project_id
        embeddings_cache[project_id] = {
            'descriptions': descriptions,
            'embeddings': embeddings,
            'raw_data': all_chips_data,
            'clusters': None,  # Will be populated when clustering is requested
            'job_id': job_id,   # Store the job_id for reference
            'feature_type': job.feature_type
        }

        # Save to disk for persistence
        save_embeddings_to_disk(project_id)

        job.status = "completed"
        job.progress = 100

    except Exception as e:
        job.status = "failed"
        job.error = str(e)
        print(f"Job {job_id} failed: {e}")

@app.route('/api/embeddings/status/<job_id>', methods=['GET'])
def get_embedding_status(job_id):
    """Get the status of an embedding job"""
    if job_id not in jobs:
        return jsonify({"error": "Job not found"}), 404

    job = jobs[job_id]
    return jsonify({
        "job_id": job_id,
        "project_id": job.project_id,
        "status": job.status,
        "progress": job.progress,
        "error": job.error if hasattr(job, 'error') else None
    })

@app.route('/api/clustering', methods=['POST'])
def cluster_embeddings():
    """Cluster embeddings with specified parameters"""
    data = request.json

    if not data or 'project_id' not in data:
        return jsonify({"error": "project_id is required"}), 400

    project_id = data['project_id']

    # Check if embeddings are in memory, if not try to load from disk
    if project_id not in embeddings_cache:
        if not load_embeddings_from_disk(project_id):
            return jsonify({"error": "Embeddings not found. Run embedding job first."}), 404

    # Get embedding data
    embedding_data = embeddings_cache[project_id]

    # Set clustering parameters
    min_cluster_size = data.get('min_cluster_size', 5)
    min_samples = data.get('min_samples', 5)
    clustering_dims = data.get('clustering_dims', 10)
    reduction_method = data.get('reduction_method', 'pca')
    feature_type = data.get('feature_type', 'both')

    try:
        # Get selected embeddings based on feature type
        selected_embeddings = embedding_service.get_selected_embeddings(
            embedding_data['raw_data'],
            feature_type
        )

        # Perform clustering and get reduced embeddings
        clusters, reduced_embeddings, reducer = clustering_service.cluster_embeddings(
            selected_embeddings,
            min_cluster_size=min_cluster_size,
            min_samples=min_samples,
            n_components=clustering_dims,
            reduction_method=reduction_method
        )

        # Update cache with clustering results and reduced embeddings
        embedding_data['clusters'] = clusters.tolist()
        embedding_data['feature_type'] = feature_type
        embedding_data['reduced_embeddings'] = reduced_embeddings
        embedding_data['reducer'] = reducer
        embedding_data['selected_embeddings'] = selected_embeddings

        # Save updated embeddings with clustering results
        save_embeddings_to_disk(project_id)

        # Get cluster statistics
        n_clusters = len(set(clusters)) - (1 if -1 in clusters else 0)
        n_noise = list(clusters).count(-1)

        return jsonify({
            "project_id": project_id,
            "num_clusters": n_clusters,
            "num_noise_points": n_noise,
            "clusters": clusters.tolist()
        })

    except Exception as e:
        print(f"Error clustering embeddings: {e}")
        #stack trace
        print(traceback.format_exc())
        return jsonify({"error": str(e)}), 500

@app.route('/api/visualization', methods=['POST'])
def get_visualization_data():
    """Get data for visualization"""
    data = request.json

    if not data or 'project_id' not in data:
        return jsonify({"error": "project_id is required"}), 400

    project_id = data['project_id']

    # Check if embeddings are in memory, if not try to load from disk
    if project_id not in embeddings_cache:
        print("Loading embeddings from disk...")
        if not load_embeddings_from_disk(project_id):
            return jsonify({"error": "Embeddings not found. Run embedding job first."}), 404

    # Get embedding data
    embedding_data = embeddings_cache[project_id]


    project_labels = cvat_service.get_project_labels(project_id)
    project_labels_dict = {x['id']: x['name'] for x in project_labels}
    # print("project_labels:")

    # Todo, filter out embeddings that have the "vehicle" label. Need to fetch annotations first then compare
    tasks_ids = [x['id'] for x in cvat_service.get_tasks(project_id)]
    job_id = 37 #TODO: Get this from the job_id in the embedding_data? But it's a hash, so not sure
    filenames_to_remove = []
    for task_id in tasks_ids:
        annotations = cvat_service.get_annotations(task_id, no_cache=True)
        for anno in annotations:
            label_name = project_labels_dict[anno['label']]
            if label_name != 'vehicle':
                chip_filename = f"task{task_id}_job{job_id}_frame{anno['frame']}_anno{anno['id']}.png"
                filenames_to_remove.append(chip_filename)
    print("get_visualization_data...embedding_data keys:")
    print(embedding_data.keys())
    print('descriptions', len(embedding_data['descriptions']))
    print('raw_data', len(embedding_data['raw_data']))
    print('embeddings', len(embedding_data['embeddings']))
    print('clusters', len(embedding_data['clusters']))
    print('reduced_embeddings', len(embedding_data['reduced_embeddings']))
    print('reduced embeddings shape', embedding_data['reduced_embeddings'].shape)
    print('selected_embeddings', len(embedding_data['selected_embeddings']))

    print('filenames_to_remove', len(filenames_to_remove))
    indexes_to_remove = []
    for i, (filename, description) in enumerate(embedding_data['descriptions']):
        if filename in filenames_to_remove:
            indexes_to_remove.append(i)
    print('indexes_to_remove', indexes_to_remove)

    #Remove the indexes from the descriptions, raw_data, embeddings, clusters, reduced_embeddings, selected_embeddings
    embedding_data['descriptions'] = [embedding_data['descriptions'][i] for i in range(len(embedding_data['descriptions'])) if i not in indexes_to_remove]
    embedding_data['raw_data'] = [embedding_data['raw_data'][i] for i in range(len(embedding_data['raw_data'])) if i not in indexes_to_remove]
    embedding_data['embeddings'] = [embedding_data['embeddings'][i] for i in range(len(embedding_data['embeddings'])) if i not in indexes_to_remove]
    embedding_data['clusters'] = [embedding_data['clusters'][i] for i in range(len(embedding_data['clusters'])) if i not in indexes_to_remove]
    # embedding_data['reduced_embeddings'] = [embedding_data['reduced_embeddings'][i] for i in range(len(embedding_data['reduced_embeddings'])) if i not in indexes_to_remove]
    # reduced embeddings is a numpy array, so we need to remove the rows
    embedding_data['reduced_embeddings'] = np.delete(embedding_data['reduced_embeddings'], indexes_to_remove, axis=0)
    embedding_data['selected_embeddings'] = [embedding_data['selected_embeddings'][i] for i in range(len(embedding_data['selected_embeddings'])) if i not in indexes_to_remove]

    print("FILTERED!")
    print('descriptions', len(embedding_data['descriptions']))
    print('raw_data', len(embedding_data['raw_data']))
    print('embeddings', len(embedding_data['embeddings']))
    print('clusters', len(embedding_data['clusters']))
    print('reduced_embeddings', len(embedding_data['reduced_embeddings']))
    print('selected_embeddings', len(embedding_data['selected_embeddings']))


    # print('reducer', len(embedding_data['reducer'])) #Type of UMAP (reducer obj)
    print('job_id', embedding_data['job_id'])
    print('feature_type', embedding_data['feature_type'])


    # embedding_data['raw_data'] = [chip for chip in embedding_data['raw_data'] if chip[1] != 'vehicle']
    # print("embedding_data['raw_data'] keys:")
    # print(embedding_data['raw_data'][0])
    # print(embedding_data['raw_data'][0].keys())

    # Set visualization parameters
    display_dims = data.get('display_dims', 3)
    reduction_method = data.get('reduction_method', 'pca')
    feature_type = embedding_data.get('feature_type', 'both')

    try:
        # Use the reduced embeddings from clustering if they exist and match the parameters
        if ('reduced_embeddings' in embedding_data and
            embedding_data.get('feature_type') == feature_type):

            reduced_embeddings = embedding_data['reduced_embeddings']

            # If we need fewer dimensions than we have, use the existing reducer

            if display_dims <= reduced_embeddings.shape[1]:
                reduced_embeddings = reduced_embeddings[:, :display_dims]
            else:
                # If we need more dimensions, we need to re-reduce from the selected embeddings
                reduced_embeddings, _ = clustering_service.reduce_dimensions(
                    embedding_data['selected_embeddings'],
                    n_components=display_dims,
                    method=reduction_method
                )
        else:
            # If we don't have reduced embeddings or parameters don't match, compute new ones
            selected_embeddings = embedding_service.get_selected_embeddings(
                embedding_data['raw_data'],
                feature_type
            )
            reduced_embeddings, _ = clustering_service.reduce_dimensions(
                selected_embeddings,
                n_components=display_dims,
                method=reduction_method
            )

        # Prepare response data
        viz_data = []
        for i, (filename, description) in enumerate(embedding_data['descriptions']):
            point_data = {
                "filename": filename,
                "description": description,
                "coordinates": reduced_embeddings[i].tolist()
            }

            if embedding_data['clusters'] is not None:
                point_data["cluster"] = int(embedding_data['clusters'][i])

            viz_data.append(point_data)

        return jsonify({
            "project_id": project_id,
            "dimensions": display_dims,
            "reduction_method": reduction_method,
            "feature_type": feature_type,
            "points": viz_data
        })

    except Exception as e:
        print(f"Error getting visualization data: {e}")
        print(traceback.format_exc())
        return jsonify({"error": str(e)}), 500

@app.route('/api/chip/<project_id>/<path:filename>', methods=['GET'])
def get_chip_image(project_id, filename):
    """Get a specific chip image with improved caching"""
    print(f"Getting chip image for {filename}")
    # Check if embeddings are in memory, if not try to load from disk
    # if project_id not in embeddings_cache:
    #     if not load_embeddings_from_disk(project_id):
    #         return jsonify({"error": "Project embeddings not found"}), 404

    # embedding_data = embeddings_cache[project_id]

    # # Find the chip data
    # chip_data = None
    # for data in embedding_data['raw_data']:
    #     if data[0] == filename:
    #         print(f"Found chip data for {filename} in cache")
    #         chip_data = data
    #         break

    # if not chip_data:
    #     return jsonify({"error": "Chip not found"}), 404

    # Extract task_id, frame_id from filename
    parts = filename.split('_')
    task_id = parts[0].replace('task', '')
    frame_id = parts[2].replace('frame', '')
    anno_id = parts[3].split('.')[0].replace('anno', '')

    # Try to get chip directly from embedding service cache
    chip = embedding_service.get_chip(task_id, frame_id, anno_id)

    if chip is None:
        print("Chip not found in cache, getting from CVAT (slow)")
        # Get frame using embedding service cache
        t = time.time()

        frame_data = cvat_service.get_frame(task_id, int(frame_id))
        # frame_data = embedding_service.get_frame(
        #     task_id,
        #     int(frame_id),
        #     lambda: cvat_service.get_frame(task_id, int(frame_id))
        # )
        print(f"Time taken to get frame: {time.time() - t} seconds")

        # Get the annotation
        t = time.time()
        annotations = cvat_service.get_annotations(task_id)
        print(f"Time taken to get annotations: {time.time() - t} seconds")

        t = time.time()
        shape = next((s for s in annotations if str(s['id']) == anno_id), None)
        print(f"Time taken to get shape in annos: {time.time() - t} seconds")

        if not shape:
            return jsonify({"error": "Annotation not found"}), 404

        # Extract and cache the chip
        t = time.time()
        print(f"Second get chip call (due to cache miss)")
        chip = embedding_service.get_chip(task_id, frame_id, anno_id, frame_data, shape)
        print(f"Time taken to get chip: {time.time() - t} seconds")
        if chip is None:
            return jsonify({"error": "Failed to extract chip"}), 500

    # Convert to bytes and return
    img_io = io.BytesIO()
    chip.save(img_io, 'PNG')
    img_io.seek(0)
    return send_file(img_io, mimetype='image/png')

@app.route('/api/labels/hierarchy/<project_id>', methods=['GET'])
def get_label_hierarchy(project_id):
    """Get hierarchical structure of labels for a project"""
    try:
        project_id = int(project_id)
        force_recalculate = request.args.get('force_recalculate', '').lower() == 'true'
        print(f"Getting label hierarchy for project {project_id} (force_recalculate={force_recalculate})")
        hierarchy = label_hierarchy_service.get_project_hierarchy(project_id, force_recalculate=force_recalculate)
        return jsonify(hierarchy)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/suggest-label', methods=['POST'])
def suggest_label():
    """Suggest a label based on chip descriptions using LLM"""
    data = request.json

    if not data or 'project_id' not in data or 'chip_descriptions' not in data:
        return jsonify({"error": "project_id and chip_descriptions are required"}), 400

    project_id = data['project_id']
    chip_descriptions = data['chip_descriptions']
    existing_labels = data.get('existing_labels', None)  # Optional parameter

    # Validate input
    if not isinstance(chip_descriptions, list) or len(chip_descriptions) == 0:
        return jsonify({"error": "chip_descriptions must be a non-empty list"}), 400

    # Validate existing_labels if provided
    if existing_labels is not None and not isinstance(existing_labels, list):
        return jsonify({"error": "existing_labels must be a list if provided"}), 400

    # Limit to 10 descriptions for performance
    if len(chip_descriptions) > 10:
        chip_descriptions = chip_descriptions[:10]

    try:
        suggested_label = label_hierarchy_service.suggest_label_for_chips(
            int(project_id),
            chip_descriptions,
            existing_labels
        )

        return jsonify({
            "project_id": project_id,
            "suggested_label": suggested_label,
            "descriptions_count": len(chip_descriptions),
            "existing_labels_count": len(existing_labels) if existing_labels else 0
        })

    except Exception as e:
        print(f"Error suggesting label: {e}")
        return jsonify({"error": str(e)}), 500

# Add this helper function with the other helper functions
def get_audio_file_path(frame_name: str) -> Path:
    """
    Convert an image frame filename to its corresponding audio file path.
    Example: frame_000000.png -> frame_000000.mp3
    """
    # Remove file extension and convert to audio extension
    base_name = os.path.splitext(frame_name)[0]
    audio_name = f"{base_name}.wav"


    # Construct path within audio files directory
    return Path(AUDIO_FILES_DIR) / audio_name

# Add this new endpoint to check audio availability
@app.route('/api/audio_check/<path:filename>', methods=['GET'])
def check_audio_file(filename):
    """
    Check if an audio file exists for a given frame.
    Returns 200 if exists, 404 if not.
    """
    print(f"Check called. Look for audio file for {filename}")
    try:
        audio_path = get_audio_file_path(filename)
        if audio_path.exists():
            return '', 200
        return '', 404
    except Exception as e:
        print(f"Error checking audio file: {e}")
        return '', 500


# Add this new endpoint
@app.route('/api/audio/<path:filename>', methods=['GET'])
def get_audio_file(filename):
    """
    Serve audio file corresponding to a frame.
    Returns 404 if the audio file doesn't exist.
    """
    print(f"Get called. Look for audio file for {filename}")

    try:
        # Get the audio file path
        audio_path = get_audio_file_path(filename)
        print(f"Audio path: {audio_path}")
        # Check if file exists
        if not audio_path.exists():
            print(f"Audio file not found: {audio_path}")
            return jsonify({"error": "Audio file not found"}), 404

        # Determine the correct MIME type
        mime_type = mimetypes.guess_type(str(audio_path))[0] or 'audio/mpeg'
        print(f"Mime type: {mime_type}")
        # Return the audio file with proper MIME type
        return send_file(
            str(audio_path),
            mimetype=mime_type,
            as_attachment=False,
            download_name=audio_path.name
        )

    except Exception as e:
        print(f"Error serving audio file: {e}")
        return jsonify({"error": str(e)}), 500





# Requires a project id and label name, creates a new label in the project
@app.route('/api/projects/<int:project_id>/labels', methods=['POST'])
def create_project_label(project_id):
    """Create a new label in a CVAT project"""
    data = request.json

    if not data or 'name' not in data:
        return jsonify({"error": "Label name is required"}), 400

    try:
        # Validate label data
        print(f"Creating label in project {project_id} with data: {data}")
        label_data = {
            'name': data['name'],
            'color': data.get('color', '#ff0000'),
            'attributes': data.get('attributes', [])
        }

        # Create label using CVAT service
        print(f"Creating label in project {project_id} with data: {label_data}")
        result = cvat_service.create_project_label(project_id, label_data)

        return jsonify({
            'project_id': project_id,
            'label': result,
            'success': True
        })

    except Exception as e:
        print(f"Error creating label: {e}")
        return jsonify({"error": str(e)}), 500

#Requires a project id, returns all labels in the project
@app.route('/api/projects/<int:project_id>/labels', methods=['GET'])
def get_project_labels(project_id):
    """Get all labels for a project (enhanced version)"""
    try:
        labels = cvat_service.get_project_labels(project_id)
        return jsonify({
            'project_id': project_id,
            'labels': labels,
            'count': len(labels)
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


#Requires a task id, new_label_id and a list of annotation_ids
@app.route('/api/annotations/update', methods=['POST'])
def update_annotation_labels():
    """Update a batch of annotations"""
    # print("Update annotations endpoint called")
    data = request.json
    # print(f"Received data for update: {data}")

    # annotation_id is a list
    if not data or 'task_id' not in data or 'new_label_id' not in data or 'annotation_ids' not in data:
        return jsonify({"error": "task_id, new_label_id and annotation_ids are required"}), 400

    # print(f"Data contains task_id: {data['task_id']}, new_label_id: {data['new_label_id']}, annotation_ids: {data['annotation_ids']}")
    try:
        task_id = int(data['task_id'])
        new_label_id = int(data['new_label_id'])
        annotation_ids = data['annotation_ids']

        # print(f"Updating annotations {annotation_ids} in task {task_id} to new label {new_label_id}")

        result = cvat_service.update_annotation_labels(task_id, annotation_ids, new_label_id)

        return jsonify({
            'task_id': task_id,
            'new_label_id': new_label_id,
            'result': result,
            'success': True
        })

    except Exception as e:
        print(f"Error updating annotation: {e}")
        return jsonify({"error": str(e)}), 500


if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
