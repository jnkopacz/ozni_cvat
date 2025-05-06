# CVAT connection settings
CVAT_HOST = 'http://192.168.2.88'
CVAT_PORT = '8080'
CVAT_USERNAME = 'justin.kopacz@ozniai.com'
CVAT_PASSWORD = 'password'

# Ollama settings
OLLAMA_HOST = 'http://localhost:11434'

# Embedding settings
CHIP_LIMIT = 100

# Available models
VISUAL_MODELS = {
    'clip': 'openai/clip-vit-base-patch32'
}

SEMANTIC_MODELS = [
    'llava:7b',
    'llava:13b',
    'gemma3:12b',
    'gemma3:27b'
]

TEXT_EMBEDDING_MODELS = [
    'nomic-embed-text',
    'all-minilm'
]

# Default models
DEFAULT_VISUAL_MODEL = 'clip'
DEFAULT_SEMANTIC_MODEL = 'gemma3:27b'
DEFAULT_TEXT_EMBEDDING_MODEL = 'all-minilm'
DEFAULT_LVLM_PROMPT = 'Describe the military object centered in this image. This image shows:'