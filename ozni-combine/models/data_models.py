class JobStatus:
    def __init__(self, id, project_id, status, progress, task_ids,
                 filter_criteria=None, feature_type='both', chip_limit=100,
                 visual_model='clip', semantic_model='gemma3:27b',
                 text_embedding_model='all-minilm', lvlm_prompt=None):
        self.id = id
        self.project_id = project_id
        self.status = status  # pending, processing, completed, failed
        self.progress = progress  # 0-100
        self.task_ids = task_ids
        self.filter_criteria = filter_criteria or {}
        self.feature_type = feature_type
        self.chip_limit = chip_limit
        self.visual_model = visual_model
        self.semantic_model = semantic_model
        self.text_embedding_model = text_embedding_model
        self.lvlm_prompt = lvlm_prompt
        self.error = None

class EmbeddingJob:
    def __init__(self, job_id, project_id, task_ids, filter_criteria=None, feature_type='both', chip_limit=100):
        self.job_id = job_id
        self.project_id = project_id
        self.task_ids = task_ids
        self.filter_criteria = filter_criteria or {}
        self.feature_type = feature_type
        self.chip_limit = chip_limit

class LabelUpdateRequest:
    def __init__(self, name, color=None, attributes=None):
        self.name = name
        self.color = color or '#ff0000'
        self.attributes = attributes or []

class LabelAttribute:
    def __init__(self, name, input_type='text', mutable=True, default_value='', values=None):
        self.name = name
        self.input_type = input_type
        self.mutable = mutable
        self.default_value = default_value
        self.values = values or []

class AnnotationUpdateRequest:
    def __init__(self, annotation_id, new_label_id):
        self.annotation_id = annotation_id
        self.new_label_id = new_label_id

class BatchUpdateResponse:
    def __init__(self, updated_count, errors, total_requested):
        self.updated_count = updated_count
        self.errors = errors
        self.total_requested = total_requested
        self.success_rate = updated_count / total_requested if total_requested > 0 else 0

class LabelCreationResponse:
    def __init__(self, id, name, color, exists=False):
        self.id = id
        self.name = name
        self.color = color
        self.exists = exists
