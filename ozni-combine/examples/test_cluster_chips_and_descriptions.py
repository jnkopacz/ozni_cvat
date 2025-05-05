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

# Connect to CVAT server
host = 'http://192.168.2.88'
username = 'justin.kopacz@ozniai.com'
password = 'password'
port = '8080'



def process_chips_and_descriptions():
    """Load existing chips and generate embeddings using CLIP and description embeddings"""
    # Initialize CLIP model and processor
    device = "cuda" if torch.cuda.is_available() else "cpu"
    model = CLIPModel.from_pretrained("openai/clip-vit-base-patch32").to(device)
    processor = CLIPProcessor.from_pretrained("openai/clip-vit-base-patch32")

    # Initialize Ollama client for text embeddings
    ollama_client = Client(host='http://localhost:11434')

    # Get all image files
    image_files = glob.glob('./sample_chips/*.png')
    image_embeddings = []
    text_embeddings = []
    descriptions = []  # We'll store tuples of (filename, description text)

    for img_file in image_files:
        # Skip description files
        if '_description.txt' in img_file:
            continue

        t = time.time()
        # Load and process image
        image = Image.open(img_file)
        inputs = processor(images=image, return_tensors="pt", padding=True).to(device)

        # Try to load associated description file
        desc_file = img_file.replace('.png', '_description.txt')
        description_text = "No description available"
        if os.path.exists(desc_file):
            with open(desc_file, 'r') as f:
                description_text = f.read().strip()

        # Generate CLIP image embedding
        with torch.no_grad():
            image_features = model.get_image_features(**inputs)
            # Convert to numpy and normalize
            img_embedding = image_features.cpu().numpy()[0]
            img_embedding = img_embedding / np.linalg.norm(img_embedding)
            print('img_embedding.shape', img_embedding.shape)

        # Generate text embedding using nomic-embed-text
        text_response = ollama_client.embeddings(
            # model='nomic-embed-text',
            model='all-minilm',
            prompt=description_text
        )
        text_embedding = text_response['embedding']
        print('text_embedding.shape', len(text_embedding))
        # Store embeddings and descriptions
        image_embeddings.append(img_embedding)
        text_embeddings.append(text_embedding)
        descriptions.append((os.path.basename(img_file), description_text))
        print(f"Processed {img_file} in {time.time() - t} seconds")

    # Combine image and text embeddings
    combined_embeddings = [np.concatenate([img_emb, text_emb])
                         for img_emb, text_emb in zip(image_embeddings, text_embeddings)]

    return descriptions, combined_embeddings

def plot_embeddings_3d(embeddings, descriptions):
    """Reduce embeddings to 3D using PCA and create an interactive scatter plot"""
    # Convert embeddings to numpy array
    embeddings_array = np.array(embeddings)
    print(embeddings_array.shape)

    # Apply PCA
    pca = PCA(n_components=3)
    embeddings_3d = pca.fit_transform(embeddings_array)

    # Create DataFrame for plotly
    df = pd.DataFrame(
        embeddings_3d,
        columns=['PC1', 'PC2', 'PC3']
    )
    df['filename'] = [desc[0] for desc in descriptions]
    # Wrap description text at 50 characters using HTML line breaks
    df['description'] = ['-<br>'.join([desc[1][i:i+50] for i in range(0, len(desc[1]), 50)])
                        for desc in descriptions]

    # Create interactive 3D scatter plot
    fig = px.scatter_3d(
        df,
        x='PC1',
        y='PC2',
        z='PC3',
        hover_data=['filename', 'description'],
        title="3D PCA Projection of Image+Description Embeddings"
    )

    # Update layout for better visualization
    fig.update_traces(
        marker=dict(size=5),
        hovertemplate="<br>".join([
            "PC1: %{x:.3f}",
            "PC2: %{y:.3f}",
            "PC3: %{z:.3f}",
            "Filename: %{customdata[0]}",
            "Description: %{customdata[1]}",
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