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

from services.cvat_service import CVATService
from services.embedding_service import EmbeddingService
from services.clustering_service import ClusteringService
from models.data_models import JobStatus, EmbeddingJob

app = Flask(__name__)
CORS(app)  # Enable CORS for all routes

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

# In-memory storage for jobs and results
# In production, consider using Redis or another persistent store
jobs = {}  # job_id -> JobStatus
embeddings_cache = {}  # project_id -> embedding data

# Initialize services
cvat_service = CVATService()
embedding_service = EmbeddingService()
clustering_service = ClusteringService()

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
    """Get embeddings for a project - checks if they exist, loads them, or starts a new job"""
    data = request.json

    if not data or 'project_id' not in data:
        return jsonify({"error": "project_id is required"}), 400

    project_id = data['project_id']
    recalculate = data.get('recalculate', False)

    # If not recalculating, check if embeddings are already available
    if not recalculate:
        # Check if embeddings are in memory
        if project_id in embeddings_cache:
            return jsonify({
                "status": "available",
                "location": "memory",
                "project_id": project_id
            })

        # Check if embeddings are on disk
        file_path = get_embedding_file_path(project_id)
        if os.path.exists(file_path):
            # Load embeddings from disk
            success = load_embeddings_from_disk(project_id)
            if success:
                return jsonify({
                    "status": "available",
                    "location": "disk",
                    "project_id": project_id
                })

    # If we get here, we need to start a new job
    # Check if we have the required parameters
    if 'task_ids' not in data:
        return jsonify({"error": "task_ids are required to start a new embedding job"}), 400

    # Create a new job
    job_id = str(uuid.uuid4())

    # Set up job parameters
    job = JobStatus(
        id=job_id,
        project_id=project_id,
        status="pending",
        progress=0,
        task_ids=data['task_ids'],
        filter_criteria=data.get('filter_criteria', {}),
        feature_type=data.get('feature_type', 'both'),
        chip_limit=data.get('chip_limit', 100)
    )

    jobs[job_id] = job

    # Start processing in a background thread
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

        # First count total frames with annotations to track progress
        for task_id in job.task_ids:
            task_info = cvat_service.get_task_info(task_id)
            annotations = cvat_service.get_annotations(task_id)

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

                # Process chips and get embeddings
                chips_data = embedding_service.embed_chips(
                    frame_data,
                    frame_shapes,
                    task_id,
                    project_id,  # Using project_id instead of job_id
                    frame_idx
                )

                all_chips_data.extend(chips_data)
                processed_frames += 1
                if job.chip_limit > 0:
                    print(f"Processed {len(all_chips_data)} frames of {job.chip_limit}")
                    job.progress = min(99, int(100 * len(all_chips_data) / job.chip_limit))
                else:
                    print(f"Processed {len(all_chips_data)} frames of {total_frames_to_process}")
                    job.progress = min(99, int(100 * len(all_chips_data) / total_frames_to_process))

                # Check if we've reached the chip limit
                if len(all_chips_data) >= job.chip_limit:
                    break

            if len(all_chips_data) >= job.chip_limit:
                break

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
    print(data)
    min_cluster_size = data.get('min_cluster_size', 5)
    min_samples = data.get('min_samples', 5)
    clustering_dims = data.get('clustering_dims', 10)
    reduction_method = data.get('reduction_method', 'pca')
    feature_type = data.get('feature_type', 'both')

    print(f"Clustering with feature type: {feature_type}")

    try:
        # Get selected embeddings based on feature type
        print(f"Getting selected embeddings")
        print(f"Raw data: {len(embedding_data['raw_data'])}")
        selected_embeddings = embedding_service.get_selected_embeddings(
            embedding_data['raw_data'],
            feature_type
        )
        print("Printing shape of selected embeddings")
        print("Num items: ", len(selected_embeddings))
        print("Num embeddings: ", len(selected_embeddings[0]))

        # Perform clustering
        clusters, reducer = clustering_service.cluster_embeddings(
            selected_embeddings,
            min_cluster_size=min_cluster_size,
            min_samples=min_samples,
            n_components=clustering_dims,
            reduction_method=reduction_method
        )

        # Update cache with clustering results
        embedding_data['clusters'] = clusters.tolist()
        embedding_data['feature_type'] = feature_type  # Store the feature type used

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
        if not load_embeddings_from_disk(project_id):
            return jsonify({"error": "Embeddings not found. Run embedding job first."}), 404

    # Get embedding data
    embedding_data = embeddings_cache[project_id]

    # Set visualization parameters
    display_dims = data.get('display_dims', 3)
    reduction_method = data.get('reduction_method', 'pca')

    try:
        # Generate visualization data
        reduced_embeddings, reducer = clustering_service.reduce_dimensions(
            embedding_data['embeddings'],
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
            "points": viz_data
        })

    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/chip/<project_id>/<path:filename>', methods=['GET'])
def get_chip_image(project_id, filename):
    """Get a specific chip image with improved caching"""
    print(f"Getting chip image for {filename}")
    # Check if embeddings are in memory, if not try to load from disk
    if project_id not in embeddings_cache:
        if not load_embeddings_from_disk(project_id):
            return jsonify({"error": "Project embeddings not found"}), 404

    embedding_data = embeddings_cache[project_id]

    # Find the chip data
    chip_data = None
    for data in embedding_data['raw_data']:
        if data[0] == filename:
            print(f"Found chip data for {filename} in cache")
            chip_data = data
            break

    if not chip_data:
        return jsonify({"error": "Chip not found"}), 404

    # Extract task_id, frame_id from filename
    parts = filename.split('_')
    task_id = parts[0].replace('task', '')
    frame_id = parts[2].replace('frame', '')
    anno_id = parts[3].split('.')[0].replace('anno', '')

    # Try to get chip directly from embedding service cache
    chip = embedding_service.get_chip(task_id, frame_id, anno_id)

    if chip is None:
        # Get frame using embedding service cache
        frame_data = embedding_service.get_frame(
            task_id,
            int(frame_id),
            lambda: cvat_service.get_frame(task_id, int(frame_id))
        )

        # Get the annotation
        annotations = cvat_service.get_annotations(task_id)
        shape = next((s for s in annotations if str(s['id']) == anno_id), None)

        if not shape:
            return jsonify({"error": "Annotation not found"}), 404

        # Extract and cache the chip
        chip = embedding_service.get_chip(task_id, frame_id, anno_id, frame_data, shape)
        if chip is None:
            return jsonify({"error": "Failed to extract chip"}), 500

    # Convert to bytes and return
    img_io = io.BytesIO()
    chip.save(img_io, 'PNG')
    img_io.seek(0)
    return send_file(img_io, mimetype='image/png')

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
