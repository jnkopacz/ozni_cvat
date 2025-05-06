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