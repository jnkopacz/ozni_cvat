from PIL import Image
import io
import torch
from transformers import CLIPProcessor, CLIPModel
from ollama import Client
import numpy as np
from config import OLLAMA_HOST, CHIP_LIMIT, VISUAL_MODELS, DEFAULT_VISUAL_MODEL, DEFAULT_SEMANTIC_MODEL, DEFAULT_TEXT_EMBEDDING_MODEL, DEFAULT_LVLM_PROMPT
from collections import OrderedDict
import time
class EmbeddingService:
    def __init__(self):
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        # Initialize models lazily to save resources
        self._models = {}
        self._ollama_client = None

        # Add caches with size limits
        self.MAX_FRAME_CACHE_SIZE = 2000
        self.MAX_CHIP_CACHE_SIZE = 20000
        self._frame_cache = OrderedDict()  # frame_key -> PIL.Image
        self._chip_cache = OrderedDict()   # chip_key -> PIL.Image

    def _get_visual_model(self, model_name):
        if model_name not in self._models:
            model_path = VISUAL_MODELS[model_name]
            self._models[model_name] = {
                'model': CLIPModel.from_pretrained(model_path).to(self.device),
                'processor': CLIPProcessor.from_pretrained(model_path)
            }
        return self._models[model_name]

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

    def generate_description(self, chip, semantic_model=DEFAULT_SEMANTIC_MODEL, lvlm_prompt=DEFAULT_LVLM_PROMPT):
        """Generate a description for a chip using specified LLM"""
        chip_bytes = io.BytesIO()
        chip.save(chip_bytes, format='PNG')
        print(f"Generating description for chip using {semantic_model} and prompt: {lvlm_prompt}")
        t = time.time()
        llava_response = self.ollama_client.generate(
            model=semantic_model,
            prompt=lvlm_prompt,
            images=[chip_bytes.getvalue()]
        )
        print(f"LVLM response time: {time.time() - t} seconds")

        return llava_response.response

    def generate_text_embedding(self, text, model=DEFAULT_TEXT_EMBEDDING_MODEL):
        """Generate text embedding using specified model"""
        print(f"Generating text embedding using {model}")
        t = time.time()
        text_response = self.ollama_client.embeddings(
            model=model,
            prompt=text
        )
        print(f"Text embedding response time: {time.time() - t} seconds")
        return text_response['embedding']

    def generate_image_embedding(self, chip, model_name=DEFAULT_VISUAL_MODEL):
        """Generate image embedding using specified model"""
        model_data = self._get_visual_model(model_name)
        t = time.time()
        inputs = model_data['processor'](images=chip, return_tensors="pt", padding=True).to(self.device)

        with torch.no_grad():
            image_features = model_data['model'].get_image_features(**inputs)
            img_embedding = image_features.cpu().numpy()[0]
            img_embedding = img_embedding / np.linalg.norm(img_embedding)

        print(f"Image embedding response time: {time.time() - t} seconds, with device: {self.device}")
        return img_embedding

    def embed_chips(self, image, shapes, task_id, job_id, frame_id,
                   visual_model=DEFAULT_VISUAL_MODEL,
                   semantic_model=DEFAULT_SEMANTIC_MODEL,
                   text_embedding_model=DEFAULT_TEXT_EMBEDDING_MODEL,
                   lvlm_prompt=DEFAULT_LVLM_PROMPT):
        """Extract chips, generate descriptions and embeddings"""
        all_data = []
        chip_count = 0

        for shape in shapes:
            if shape['type'] == "rectangle":
                chip = self.get_chip(task_id, frame_id, shape['id'], image, shape)
                if chip is None:
                    continue

                description = self.generate_description(chip, semantic_model, lvlm_prompt)
                text_embedding = self.generate_text_embedding(description, text_embedding_model)
                img_embedding = self.generate_image_embedding(chip, visual_model)

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