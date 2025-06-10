from PIL import Image
import io
import torch
from transformers import CLIPProcessor, CLIPModel
from ollama import Client
import numpy as np
from config import OLLAMA_HOST, CHIP_LIMIT, VISUAL_MODELS, DEFAULT_VISUAL_MODEL, DEFAULT_SEMANTIC_MODEL, DEFAULT_TEXT_EMBEDDING_MODEL, DEFAULT_LVLM_PROMPT
from collections import OrderedDict
import time
import os
from openai import OpenAI
import base64

class EmbeddingService:
    def __init__(self):
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        # Initialize models lazily to save resources
        self._models = {}
        self._ollama_client = None
        self._openai_client = None

        # Add caches with size limits
        self.MAX_FRAME_CACHE_SIZE = 2000
        self.MAX_CHIP_CACHE_SIZE = 100000
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

    @property
    def openai_client(self):
        if self._openai_client is None:
            api_key = os.getenv('OPENAI_API_KEY')
            if not api_key:
                raise ValueError("OPENAI_API_KEY environment variable is required for GPT models")
            self._openai_client = OpenAI(api_key=api_key)
        return self._openai_client

    def _get_frame_cache_key(self, task_id, frame_id):
        return f"{task_id}_{frame_id}"

    def _get_chip_cache_key(self, task_id, frame_id, shape_id):
        return f"task{task_id}_job{task_id}_frame{frame_id}_anno{shape_id}.png"

    def get_frame(self, task_id, frame_id, frame_loader):
        """Get a frame from cache or load it using the provided loader function"""
        cache_key = self._get_frame_cache_key(task_id, frame_id)

        if cache_key in self._frame_cache:
            print(f"Frame cache hit for task {task_id}, frame {frame_id}")
            return self._frame_cache[cache_key]

        # Load frame using provided function
        t = time.time()
        frame = frame_loader()
        print(f"Time taken for frame loader: {time.time() - t} seconds")

        # Add to cache with size limit
        if len(self._frame_cache) >= self.MAX_FRAME_CACHE_SIZE:
            self._frame_cache.popitem(last=False)  # Remove oldest item
        self._frame_cache[cache_key] = frame

        return frame

    def get_chip(self, task_id, frame_id, shape_id, frame=None, shape=None, over_clip=1.0):
        """Get a chip from cache or extract it from the frame"""
        cache_key = self._get_chip_cache_key(task_id, frame_id, shape_id)

        if cache_key in self._chip_cache:
            print(f"Chip cache hit for task {task_id}, frame {frame_id}, shape {shape_id}")
            return self._chip_cache[cache_key]

        if frame is None or shape is None:
            print(f"Chip not found in cache")
            return None

        # Extract chip from preloaded frame
        t = time.time()
        frame.load()
        print(f"Time taken to load frame: {time.time() - t} seconds")

        t = time.time()
        chip = self.extract_chip(frame, shape)
        print(f"Time taken to extract chip from preloaded frame..: {time.time() - t} seconds")
        if chip is None:
            return None

        # Add to cache with size limit
        if len(self._chip_cache) >= self.MAX_CHIP_CACHE_SIZE:
            self._chip_cache.popitem(last=False)  # Remove oldest item
        self._chip_cache[cache_key] = chip

        return chip

    def extract_chip(self, image, shape, min_size=140):
        """Extract a chip from an image based on annotation shape

        Args:
            image: PIL Image
            shape: Annotation shape dictionary
            min_size: Minimum size for the smallest dimension of the chip
        """
        if shape['type'] == "rectangle":
            x1, y1, x2, y2 = map(int, shape['points'])

            # Start with base dimensions
            width = x2 - x1
            height = y2 - y1

            # Calculate required scaling to meet minimum size
            if min(width, height) < min_size:
                scale = min_size / min(width, height)
            else:
                scale = 1.0

            # Calculate center point
            center_x = (x1 + x2) / 2
            center_y = (y1 + y2) / 2

            # Calculate new dimensions with scaling
            new_width = width * scale
            new_height = height * scale

            # Calculate new coordinates, ensuring they stay within image bounds
            new_x1 = int(max(0, int(center_x - new_width / 2)))
            new_y1 = int(max(0, int(center_y - new_height / 2)))
            new_x2 = int(min(image.width, int(center_x + new_width / 2)))
            new_y2 = int(min(image.height, int(center_y + new_height / 2)))

            chip = image.crop((new_x1, new_y1, new_x2, new_y2))
            return chip
        return None

    def generate_description(self, chip, semantic_model=DEFAULT_SEMANTIC_MODEL, lvlm_prompt=DEFAULT_LVLM_PROMPT):
        """Generate a description for a chip using specified LLM"""
        chip_bytes = io.BytesIO()
        chip.save(chip_bytes, format='PNG')
        print(f"Generating description for chip using {semantic_model} and prompt: {lvlm_prompt}")
        t = time.time()

        if semantic_model.startswith('gpt-') or semantic_model.startswith('o4-'):
            # Use OpenAI API for GPT models
            try:
                response = self.openai_client.chat.completions.create(
                    model=semantic_model,
                    messages=[
                        {"role": "user", "content": [
                            {"type": "text", "text": lvlm_prompt},
                            {"type": "image_url",
                             "image_url": {"url": f"data:image/png;base64,{base64.b64encode(chip_bytes.getvalue()).decode()}"}}
                        ]}
                    ],
                    max_tokens=300
                )
                description = response.choices[0].message.content
            except Exception as e:
                print(f"Error using OpenAI API: {e}")
                return "Error generating description with OpenAI"
        else:
            # Use Ollama for other models
            llava_response = self.ollama_client.generate(
                model=semantic_model,
                prompt=lvlm_prompt,
                images=[chip_bytes.getvalue()]
            )
            description = llava_response.response
        print(f"Description: {description}")
        #Save chip to file
        print(f"LVLM response time: {time.time() - t} seconds")
        return description

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
                chip = self.get_chip(task_id, frame_id, shape['id'], image, shape, over_clip=1.0)
                #print dimensions of chip

                if chip is None:
                    continue


                description = self.generate_description(chip, semantic_model, lvlm_prompt)
                #Save chip to file
                # print(f"Saving chip to file chip_{task_id}_{frame_id}_{shape['id']}.png")
                # chip.save(f"chip_{task_id}_{frame_id}_{shape['id']}.png")
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