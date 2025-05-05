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

# Connect to CVAT server
host = 'http://192.168.2.88'
username = 'justin.kopacz@ozniai.com'
password = 'password'
port = '8080'



def process_chips_and_descriptions():
    """Load existing chips and their descriptions, generate embeddings"""
    # Initialize Ollama client
    ollama_client = Client(host='http://localhost:11434')

    # Get all description files
    desc_files = glob.glob('./sample_chips/*_description.txt')
    embeddings = []
    descriptions = []

    for desc_file in desc_files:
        # Read description
        t=time.time()
        with open(desc_file, 'r') as f:
            description = f.read().strip()
            descriptions.append(description)

        # Generate embedding using nomic-embed-text
        response = ollama_client.embeddings(
            model='nomic-embed-text',
            prompt=description
        )
        embeddings.append(response['embedding'])
        print(f"Processed {desc_file} in {time.time() - t} seconds")

    return descriptions, embeddings

def plot_embeddings_3d(embeddings, descriptions):
    """Reduce embeddings to 3D using PCA and create an interactive scatter plot"""
    # Convert embeddings to numpy array
    embeddings_array = np.array(embeddings)

    # Apply PCA
    pca = PCA(n_components=3)
    embeddings_3d = pca.fit_transform(embeddings_array)

    # Create DataFrame for plotly
    df = pd.DataFrame(
        embeddings_3d,
        columns=['PC1', 'PC2', 'PC3']
    )
    df['description'] = descriptions

    # Create interactive 3D scatter plot
    fig = px.scatter_3d(
        df,
        x='PC1',
        y='PC2',
        z='PC3',
        hover_data=['description'],
        title="3D PCA Projection of Image Embeddings"
    )

    # Update layout for better visualization
    fig.update_traces(
        marker=dict(size=5),
        hovertemplate="<br>".join([
            "PC1: %{x}",
            "PC2: %{y}",
            "PC3: %{z}",
            "Description: %{customdata[0]}",
            "<extra></extra>"
        ])
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
    fig.write_html("embeddings_plot_3d.html")

# Connect to CVAT
with make_client(host, port=port, credentials=(username, password)) as client:
    total_chips = 0

    # Get tasks
    tasks = client.tasks.list()

    # for task in tasks:
    #     # Get annotations for the task
    #     annotations = task.get_annotations()

    #     # Process frames until we get 100 chips
    #     for frame_idx in range(len(task.get_frames_info())):
    #         # Get the frame image
    #         frame_data = task.get_frame(frame_idx)
    #         image = Image.open(frame_data)

    #         # Get shapes for this frame
    #         frame_shapes = [shape for shape in annotations.shapes
    #                       if shape.frame == frame_idx]

    #         # Save chips from this frame
    #         # chips_saved = save_chips(image, frame_shapes, task.id, task.id, frame_idx)
    #         # total_chips += chips_saved

    #         if total_chips >= CHIP_LIMIT:
    #             print(f"Saved {total_chips} chips")
    #             break

    #     if total_chips >= CHIP_LIMIT:
    #         break

    # After processing all frames, get descriptions and embeddings
descriptions, embeddings = process_chips_and_descriptions()
print(f"Generated embeddings for {len(descriptions)} descriptions")

# Plot the embeddings in 3D
plot_embeddings_3d(embeddings, descriptions)
print("Created interactive 3D visualization of embeddings")

print(f"Finished saving {total_chips} chips")