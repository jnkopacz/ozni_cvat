import numpy as np
import json

class NumpyEncoder(json.JSONEncoder):
    """Custom JSON encoder for NumPy types"""
    def default(self, obj):
        if isinstance(obj, np.ndarray):
            return obj.tolist()
        if isinstance(obj, np.integer):
            return int(obj)
        if isinstance(obj, np.floating):
            return float(obj)
        return super(NumpyEncoder, self).default(obj)

def serialize_embeddings(embeddings_data):
    """Serialize embeddings data to JSON"""
    return json.dumps(embeddings_data, cls=NumpyEncoder)

def deserialize_embeddings(json_data):
    """Deserialize embeddings data from JSON"""
    data = json.loads(json_data)

    # Convert lists back to numpy arrays where needed
    if 'embeddings' in data:
        data['embeddings'] = np.array(data['embeddings'])
    if 'clusters' in data and data['clusters'] is not None:
        data['clusters'] = np.array(data['clusters'])

    return data