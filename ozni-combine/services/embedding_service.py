from PIL import Image
import io
import torch
from transformers import CLIPProcessor, CLIPModel
from ollama import Client
import numpy as np
from config import CLIP_MODEL, OLLAMA_HOST, CHIP_LIMIT
from collections import OrderedDict

class EmbeddingService:
    def __init__(self):
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        # Initialize models lazily to save resources
        self._clip_model = None
        self._clip_processor = None
        self._ollama_client = None

        # Add caches with size limits
        self.MAX_FRAME_CACHE_SIZE = 2000
        self.MAX_CHIP_CACHE_SIZE = 20000
        self._frame_cache = OrderedDict()  # frame_key -> PIL.Image
        self._chip_cache = OrderedDict()   # chip_key -> PIL.Image

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

    def _get_frame_cache_key(self, task_id, frame_id):
        return f"{task_id}_{frame_id}"

    def _get_chip_cache_key(self, task_id, frame_id, shape_id):
        return f"task{task_id}_job{task_id}_frame{frame_id}_anno{shape_id}.png"

    def get_frame(self, task_id, frame_id, frame_loader):
        """Get a frame from cache or load it using the provided loader function"""
        cache_key = self._get_frame_cache_key(task_id, frame_id)

        if cache_key in self._frame_cache:
            return self._frame_cache[cache_key]

        # Load frame using provided function
        frame = frame_loader()

        # Add to cache with size limit
        if len(self._frame_cache) >= self.MAX_FRAME_CACHE_SIZE:
            self._frame_cache.popitem(last=False)  # Remove oldest item
        self._frame_cache[cache_key] = frame

        return frame

    def get_chip(self, task_id, frame_id, shape_id, frame=None, shape=None):
        """Get a chip from cache or extract it from the frame"""
        cache_key = self._get_chip_cache_key(task_id, frame_id, shape_id)

        if cache_key in self._chip_cache:
            return self._chip_cache[cache_key]

        if frame is None or shape is None:
            return None

        chip = self.extract_chip(frame, shape)
        if chip is None:
            return None

        # Add to cache with size limit
        if len(self._chip_cache) >= self.MAX_CHIP_CACHE_SIZE:
            self._chip_cache.popitem(last=False)  # Remove oldest item
        self._chip_cache[cache_key] = chip

        return chip

    def extract_chip(self, image, shape):
        """Extract a chip from an image based on annotation shape"""
        if shape['type'] == "rectangle":
            x1, y1, x2, y2 = map(int, shape['points'])
            chip = image.crop((x1, y1, x2, y2))
            return chip
        return None

    def generate_description(self, chip):
        """Generate a description for a chip using LLaVA"""
        chip_bytes = io.BytesIO()
        chip.save(chip_bytes, format='PNG')
        # prompt = "This image was collected from a satellite. Respond with a brief, one-line description of the object. This image shows:"
        prompt = "Describe the military object centered in this image. This image shows:"

        # model = "llava:13b"
        # model = "llava:7b"
        model = 'gemma3:27b'
        # model = 'gemma3:12b'
        llava_response = self.ollama_client.generate(
            model=model,
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
                # Get chip using cache
                chip = self.get_chip(task_id, frame_id, shape['id'], image, shape)
                if chip is None:
                    continue

                # Generate description
                description = self.generate_description(chip)

                # Generate text embedding
                text_embedding = self.generate_text_embedding(description)

                # Generate image embedding
                img_embedding = self.generate_image_embedding(chip)

                # Create virtual filename for reference
                virtual_filename = self._get_chip_cache_key(task_id, frame_id, shape['id'])

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