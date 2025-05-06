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
}

export interface ClusteringResponse {
  project_id: number;
  num_clusters: number;
  num_noise_points: number;
  clusters: number[];
}
