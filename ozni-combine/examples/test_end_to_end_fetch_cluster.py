import cvat_sdk
from cvat_sdk import make_client
from PIL import Image
import os
from ollama import Client
import io
import glob
import time
import numpy as np
from sklearn.decomposition import PCA
import plotly.express as px
import plotly.graph_objects as go
import pandas as pd
import torch
from transformers import CLIPProcessor, CLIPModel
from tqdm import tqdm
import pickle
import argparse
import hdbscan
from sklearn.preprocessing import StandardScaler
import umap

# Connect to CVAT server
host = 'http://192.168.2.88'
username = 'justin.kopacz@ozniai.com'
password = 'password'
port = '8080'

CHIP_LIMIT = 100

def embed_chips(image, shapes, task_id, job_id, frame_id):
    """Extract chips, generate descriptions and embeddings all in one pass"""
    device = "cuda" if torch.cuda.is_available() else "cpu"
    clip_model = CLIPModel.from_pretrained("openai/clip-vit-base-patch32").to(device)
    clip_processor = CLIPProcessor.from_pretrained("openai/clip-vit-base-patch32")
    ollama_client = Client(host='http://localhost:11434')

    all_data = []  # List to store (filename, description, image_embedding, text_embedding)

    chip_count = 0
    for shape in shapes:
        if str(shape.type).split('.')[-1].lower() == "rectangle":
            # Extract chip
            x1, y1, x2, y2 = map(int, shape.points)
            chip = image.crop((x1, y1, x2, y2))

            # Generate LLaVA description
            chip_bytes = io.BytesIO()
            chip.save(chip_bytes, format='PNG')
            prompt = "This image was collected from a satellite. Respond with a brief, one-line description of the object. This image shows:"
            llava_response = ollama_client.generate(
                model="llava:7b",
                prompt=prompt,
                images=[chip_bytes.getvalue()]
            )
            description = llava_response.response

            # Generate text embedding
            text_response = ollama_client.embeddings(
                model='all-minilm',
                prompt=description
            )
            text_embedding = text_response['embedding']

            # Generate CLIP image embedding
            inputs = clip_processor(images=chip, return_tensors="pt", padding=True).to(device)
            with torch.no_grad():
                image_features = clip_model.get_image_features(**inputs)
                img_embedding = image_features.cpu().numpy()[0]
                img_embedding = img_embedding / np.linalg.norm(img_embedding)

            # Create virtual filename for reference (without saving)
            virtual_filename = f"task{task_id}_job{job_id}_frame{frame_id}_anno{shape.id}.png"

            all_data.append((
                virtual_filename,
                description,
                img_embedding,
                text_embedding
            ))

            chip_count += 1
            if chip_count >= CHIP_LIMIT:
                break

    return all_data

def reduce_dimensions(embeddings, n_components, method='pca'):
    """Reduce dimensionality using either PCA or UMAP"""
    if method.lower() == 'pca':
        reducer = PCA(n_components=n_components)
    else:  # umap
        reducer = umap.UMAP(n_components=n_components, random_state=42)

    reduced_embeddings = reducer.fit_transform(embeddings)

    if method.lower() == 'pca':
        print(f"Explained variance ratio: {reducer.explained_variance_ratio_}")
        print(f"Cumulative explained variance: {np.cumsum(reducer.explained_variance_ratio_)}")

    return reduced_embeddings, reducer

def cluster_embeddings(embeddings, min_cluster_size=5, min_samples=5, n_components=10, reduction_method='pca'):
    """Cluster embeddings using HDBSCAN on dimensionality-reduced features"""
    # First reduce dimensionality
    reduced_embeddings, reducer = reduce_dimensions(
        embeddings,
        n_components=n_components,
        method=reduction_method
    )

    # Scale the reduced embeddings
    scaler = StandardScaler()
    scaled_embeddings = scaler.fit_transform(reduced_embeddings)

    # Apply HDBSCAN
    clusterer = hdbscan.HDBSCAN(
        min_cluster_size=min_cluster_size,
        min_samples=min_samples,
        prediction_data=True
    )
    clusters = clusterer.fit_predict(scaled_embeddings)

    # Print clustering statistics
    n_clusters = len(set(clusters)) - (1 if -1 in clusters else 0)
    n_noise = list(clusters).count(-1)
    print(f"Number of clusters: {n_clusters}")
    print(f"Number of noise points: {n_noise}")

    return clusters, reducer

def plot_embeddings_3d(embeddings, descriptions, clusters=None, reduction_method='pca'):
    """Reduce embeddings to 3D using specified method and create an interactive scatter plot"""
    # Reduce dimensionality to 3D
    embeddings_3d, reducer = reduce_dimensions(embeddings, n_components=3, method=reduction_method)

    # Create DataFrame for plotly
    df = pd.DataFrame(
        embeddings_3d,
        columns=['Dim1', 'Dim2', 'Dim3']
    )
    df['filename'] = [desc[0] for desc in descriptions]
    df['description'] = ['-<br>'.join([desc[1][i:i+50] for i in range(0, len(desc[1]), 50)])
                        for desc in descriptions]

    # Add cluster information
    if clusters is not None:
        df['Cluster'] = [f'Cluster {c}' if c >= 0 else 'Noise' for c in clusters]
        hover_data = ['filename', 'description', 'Cluster']
    else:
        hover_data = ['filename', 'description']

    # Create interactive 3D scatter plot
    fig = px.scatter_3d(
        df,
        x='Dim1',
        y='Dim2',
        z='Dim3',
        color='Cluster' if clusters is not None else None,
        hover_data=hover_data,
        title="3D Projection of Image+Description Embeddings"
    )

    # Update traces for better visualization
    fig.update_traces(
        marker=dict(size=5),
        hovertemplate="<br>".join([
            "Dim1: %{x:.3f}",
            "Dim2: %{y:.3f}",
            "Dim3: %{z:.3f}",
            "Filename: %{customdata[0]}",
            "Description: %{customdata[1]}",
            "<extra></extra>"
        ]) + ("<br>%{customdata[2]}" if clusters is not None else ""),
        hoverlabel=dict(
            bgcolor="white",
            font_color="black"
        )
    )

    # Update layout
    fig.update_layout(
        scene=dict(
            xaxis_title="First Principal Component",
            yaxis_title="Second Principal Component",
            zaxis_title="Third Principal Component"
        ),
        width=1000,
        height=800
    )

    # Save as interactive HTML file
    fig.write_html("embeddings_plot.html")

    return embeddings_3d, reducer

def plot_embeddings_2d(embeddings, descriptions, clusters=None, reduction_method='pca'):
    """Reduce embeddings to 2D using specified method and create an interactive scatter plot"""
    # Reduce dimensionality to 2D
    embeddings_2d, reducer = reduce_dimensions(embeddings, n_components=2, method=reduction_method)

    # Create DataFrame for plotly
    df = pd.DataFrame(
        embeddings_2d,
        columns=['Dim1', 'Dim2']
    )
    df['filename'] = [desc[0] for desc in descriptions]
    df['description'] = ['-<br>'.join([desc[1][i:i+50] for i in range(0, len(desc[1]), 50)])
                        for desc in descriptions]

    if clusters is not None:
        df['Cluster'] = [f'Cluster {c}' if c >= 0 else 'Noise' for c in clusters]

    # Create interactive 2D scatter plot
    fig = px.scatter(
        df,
        x='Dim1',
        y='Dim2',
        color='Cluster' if clusters is not None else None,
        hover_data=['filename', 'description'],
        title="2D Projection of Image+Description Embeddings"
    )

    # Update layout
    fig.update_layout(
        width=1000,
        height=800,
        xaxis_title="First Principal Component",
        yaxis_title="Second Principal Component"
    )

    # Save as interactive HTML file
    fig.write_html("embeddings_plot.html")

    return embeddings_2d, reducer

def plot_embeddings(embeddings, descriptions, clusters=None, display_dims=3, reduction_method='pca'):
    """Plot embeddings in either 2D or 3D based on display_dims parameter"""
    if display_dims == 3:
        return plot_embeddings_3d(embeddings, descriptions, clusters, reduction_method)
    else:
        return plot_embeddings_2d(embeddings, descriptions, clusters, reduction_method)

def get_selected_embeddings(data, feature_type='both'):
    """Extract selected embeddings based on feature type"""
    if isinstance(data, list):  # Raw data format
        if feature_type == 'image':
            return [img_emb for _, _, img_emb, _ in data]
        elif feature_type == 'text':
            return [text_emb for _, _, _, text_emb in data]
        else:  # both
            return [np.concatenate([img_emb, text_emb])
                   for _, _, img_emb, text_emb in data]
    else:  # Dictionary format from pkl
        raw_data = data['raw_data']
        return get_selected_embeddings(raw_data, feature_type)

def main(num_chips, pkl_file=None, min_cluster_size=5, min_samples=5, clustering_dims=10,
         display_dims=3, reduction_method='pca', feature_type='both'):
    if pkl_file:
        print(f"Loading data from {pkl_file}")
        with open(pkl_file, 'rb') as f:
            data = pickle.load(f)

        # Get selected embeddings
        embeddings = get_selected_embeddings(data, feature_type)
        descriptions = data['descriptions']

        # Perform clustering
        clusters, reducer = cluster_embeddings(embeddings,
                                    min_cluster_size=min_cluster_size,
                                    min_samples=min_samples,
                                    n_components=clustering_dims,
                                    reduction_method=reduction_method)

        # Plot with cluster colors using specified dimensions
        plot_embeddings(embeddings, descriptions, clusters, display_dims, reduction_method)
        print(f"Created interactive {display_dims}D visualization of embeddings with clusters")
        return

    # Original data collection logic
    with make_client(host, port=port, credentials=(username, password)) as client:
        all_chips_data = []

        # Create progress bar
        pbar = tqdm(total=num_chips, desc="Processing chips")
        prev_count = 0
        t = time.time()
        tasks = client.tasks.list()
        for task in tasks:
            annotations = task.get_annotations()

            for frame_idx in range(len(task.get_frames_info())):
                frame_data = task.get_frame(frame_idx)
                image = Image.open(frame_data)

                frame_shapes = [shape for shape in annotations.shapes
                              if shape.frame == frame_idx]

                # Get chips data with descriptions and embeddings
                chips_data = embed_chips(image, frame_shapes, task.id, task.id, frame_idx)
                all_chips_data.extend(chips_data)

                # Update progress bar with new chips
                current_count = len(all_chips_data)
                pbar.update(current_count - prev_count)
                prev_count = current_count

                if len(all_chips_data) >= num_chips:
                    break

            if len(all_chips_data) >= num_chips:
                break

        pbar.close()

        # Prepare data for visualization
        descriptions = [(filename, desc) for filename, desc, _, _ in all_chips_data]
        embeddings = get_selected_embeddings(all_chips_data, feature_type)

        print(f"Generated embeddings for {len(descriptions)} chips")

        # Perform clustering
        clusters, reducer = cluster_embeddings(embeddings, min_cluster_size=min_cluster_size,
                                            min_samples=min_samples, n_components=clustering_dims,
                                            reduction_method=reduction_method)

        # Update data_to_save to include clusters
        data_to_save = {
            'descriptions': descriptions,
            'embeddings': embeddings,
            'clusters': clusters,
            'raw_data': all_chips_data
        }
        print(f"Embedded chips in: {time.time() - t} seconds")
        with open(f'chips_embeddings_task_{task.id}_{len(all_chips_data)}.pkl', 'wb') as f:
            pickle.dump(data_to_save, f)

        # Create visualization with clusters
        plot_embeddings(embeddings, descriptions, clusters, display_dims, reduction_method)
        print(f"Created interactive {display_dims}D visualization of embeddings with clusters")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description='Process satellite imagery chips and generate embeddings')
    parser.add_argument('--num-chips', type=int, default=100,
                      help='Number of chips to process (default: 100)')
    parser.add_argument('--pkl-file', type=str,
                      help='Path to pickle file to load instead of processing new data')
    parser.add_argument('--min-cluster-size', type=int, default=5,
                      help='HDBSCAN min_cluster_size parameter (default: 5)')
    parser.add_argument('--min-samples', type=int, default=5,
                      help='HDBSCAN min_samples parameter (default: 5)')
    parser.add_argument('--clustering-dims', type=int, default=10,
                      help='Number of PCA components to use (default: 10)')
    parser.add_argument('--display-dims', type=int, choices=[2, 3], default=3,
                      help='Number of dimensions for visualization (2 or 3, default: 3)')
    parser.add_argument('--reduction-method', type=str, choices=['pca', 'umap'], default='pca',
                      help='Dimensionality reduction method to use (default: pca)')
    parser.add_argument('--feature-type', type=str, choices=['image', 'text', 'both'], default='both',
                      help='Type of features to use for clustering (default: both)')

    args = parser.parse_args()
    main(args.num_chips, args.pkl_file,
         args.min_cluster_size, args.min_samples, args.clustering_dims,
         args.display_dims, args.reduction_method, args.feature_type)