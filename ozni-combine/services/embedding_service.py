from PIL import Image
import io
import torch
from transformers import CLIPProcessor, CLIPModel
from ollama import Client
import numpy as np
from config import CLIP_MODEL, OLLAMA_HOST, CHIP_LIMIT

class EmbeddingService:
    def __init__(self):
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        # Initialize models lazily to save resources
        self._clip_model = None
        self._clip_processor = None
        self._ollama_client = None

    @property
    def clip_model(self):
        if self._clip_model is None:
            self._clip_model = CLIPModel.from_pretrained(CLIP_MODEL).to(self.device)
        return self._clip_model

    @property
    def clip_processor(self):
        if self._clip_processor is None:
            self._clip_processor = CLIPProcessor.from_pretrained(CLIP_MODEL)
        return self._clip_processor

    @property
    def ollama_client(self):
        if self._ollama_client is None:
            self._ollama_client = Client(host=OLLAMA_HOST)
        return self._ollama_client

    def extract_chip(self, image, shape):
        """Extract a chip from an image based on annotation shape"""
        if shape['type'] == "rectangle":
            x1, y1, x2, y2 = map(int, shape['points'])
            return image.crop((x1, y1, x2, y2))
        return None

    def generate_description(self, chip):
        """Generate a description for a chip using LLaVA"""
        chip_bytes = io.BytesIO()
        chip.save(chip_bytes, format='PNG')
        prompt = "This image was collected from a satellite. Respond with a brief, one-line description of the object. This image shows:"

        llava_response = self.ollama_client.generate(
            model="llava:7b",
            prompt=prompt,
            images=[chip_bytes.getvalue()]
        )

        return llava_response.response

    def generate_text_embedding(self, text):
        """Generate text embedding using Ollama"""
        text_response = self.ollama_client.embeddings(
            model='all-minilm',
            prompt=text
        )
        return text_response['embedding']

    def generate_image_embedding(self, chip):
        """Generate image embedding using CLIP"""
        inputs = self.clip_processor(images=chip, return_tensors="pt", padding=True).to(self.device)

        with torch.no_grad():
            image_features = self.clip_model.get_image_features(**inputs)
            img_embedding = image_features.cpu().numpy()[0]
            img_embedding = img_embedding / np.linalg.norm(img_embedding)

        return img_embedding

    def embed_chips(self, image, shapes, task_id, job_id, frame_id):
        """Extract chips, generate descriptions and embeddings"""
        all_data = []  # List to store (filename, description, image_embedding, text_embedding)

        chip_count = 0
        for shape in shapes:
            if shape['type'] == "rectangle":
                # Extract chip
                chip = self.extract_chip(image, shape)
                if chip is None:
                    continue

                # Generate description
                description = self.generate_description(chip)

                # Generate text embedding
                text_embedding = self.generate_text_embedding(description)

                # Generate image embedding
                img_embedding = self.generate_image_embedding(chip)

                # Create virtual filename for reference
                virtual_filename = f"task{task_id}_job{job_id}_frame{frame_id}_anno{shape['id']}.png"

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

    def get_selected_embeddings(self, data, feature_type='both'):
        """Extract selected embeddings based on feature type"""
        if isinstance(data, list):  # Raw data format
            if feature_type == 'image':
                return [img_emb for _, _, img_emb, _ in data]
            elif feature_type == 'text':
                return [text_emb for _, _, _, text_emb in data]
            else:  # both
                return [np.concatenate([img_emb, text_emb])
                       for _, _, img_emb, text_emb in data]
        else:  # Dictionary format
            raw_data = data['raw_data']
            return self.get_selected_embeddings(raw_data, feature_type)