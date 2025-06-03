// src/models/types.ts
export interface Project {
  id: number;
  name: string;
  created_date: string;
  updated_date: string;
  status: string;
  task_count: number;
}

export interface Task {
  id: number;
  name: string;
  project_id: number;
  status: string;
  created_date: string;
  updated_date: string;
}

export interface EmbeddingStatus {
  exists: boolean;
  location?: string;
}

export interface EmbeddingJob {
  job_id: string;
  project_id: number;
  status: string;
  progress: number;
  error?: string;
}

export interface EmbeddingJobRequest {
  project_id: number;
  task_ids: number[];
  feature_type: 'visual' | 'semantic' | 'both';
  chip_limit: number;
  recalculate?: boolean;
  visual_model?: string;
  semantic_model?: string;
  text_embedding_model?: string;
  lvlm_prompt?: string;
}

export interface EmbeddingJobResponse {
  status: string;
  job_id?: string;
  project_id: number;
  location?: string;
}

export interface ClusteringRequest {
  project_id: number;
  min_cluster_size: number;
  min_samples: number;
  clustering_dims: number;
  reduction_method: string;
  feature_type?: 'visual' | 'semantic' | 'both';
}

export interface ClusteringResponse {
  project_id: number;
  num_clusters: number;
  num_noise_points: number;
  clusters: number[];
}

// Label management interfaces
export interface Label {
  id: number;
  name: string;
  color?: string;
  attributes?: LabelAttribute[];
}

export interface LabelAttribute {
  name: string;
  input_type: string;
  mutable: boolean;
  default_value: string;
  values: string[];
}

export interface LabelCreateRequest {
  name: string;
  color?: string;
  attributes?: LabelAttribute[];
}

export interface LabelCreateResponse {
  project_id: number;
  label: {
    id: number;
    name: string;
    color: string;
    exists: boolean;
  };
  success: boolean;
}

export interface ProjectLabelsResponse {
  project_id: number;
  labels: Label[];
  count: number;
}

// Annotation update interfaces
export interface AnnotationUpdate {
  annotation_id: number;
  new_label_id: number;
}

export interface AnnotationUpdateRequest {
  task_id: number;
  updates: AnnotationUpdate[];
}

export interface AnnotationUpdateResponse {
  task_id: number;
  result: {
    updated_count: number;
    errors: string[];
    total_requested: number;
  };
  success: boolean;
}

export interface SingleAnnotationUpdateResponse {
  annotation_id: number;
  task_id: number;
  new_label_id: number;
  result: {
    updated_count: number;
    errors: string[];
    total_requested: number;
  };
  success: boolean;
}

export interface ValidationResult {
  annotation_id: number;
  new_label_id: number;
  valid: boolean;
  errors: string[];
}

export interface ValidationResponse {
  task_id: number;
  validation_results: ValidationResult[];
  summary: {
    total: number;
    valid: number;
    invalid: number;
  };
  all_valid: boolean;
}

export interface AnnotationWithLabel {
  id: number;
  type: string;
  frame: number;
  label_id: number;
  label_name: string;
  points: number[];
  attributes: Record<string, any>;
}

export interface TaskAnnotationsResponse {
  task_id: number;
  annotations: AnnotationWithLabel[];
  count: number;
}

export interface AnnotationResponse {
  annotation: AnnotationWithLabel;
  task_id: number;
}
