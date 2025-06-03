// src/api/api.ts
import axios from 'axios';

const API_BASE_URL = 'http://192.168.2.88:5000/api'; // Update this to your backend URL

export const api = {
  // Project endpoints
  getProjects: async () => {
    const response = await axios.get(`${API_BASE_URL}/projects`);
    return response.data;
  },

  getTasks: async (projectId: number) => {
    const response = await axios.get(`${API_BASE_URL}/tasks`, {
      params: { project_id: projectId }
    });
    return response.data;
  },

  // Embedding endpoints
  checkEmbeddings: async (projectId: number) => {
    const response = await axios.get(`${API_BASE_URL}/embeddings/check`, {
      params: { project_id: projectId }
    });
    return response.data;
  },

  startEmbeddingJob: async (data: any) => {
    const response = await axios.post(`${API_BASE_URL}/embeddings/start`, data);
    return response.data;
  },

  getEmbeddingStatus: async (jobId: string) => {
    const response = await axios.get(`${API_BASE_URL}/embeddings/status/${jobId}`);
    return response.data;
  },

  getEmbeddingJobStatus: async function(jobId: string) {
    // Alias for getEmbeddingStatus for backward compatibility
    return this.getEmbeddingStatus.bind(this)(jobId);
  },

  getEmbeddings: async (data: any) => {
    const response = await axios.post(`${API_BASE_URL}/embeddings/get`, data);
    return response.data;
  },

  // Clustering endpoints
  clusterEmbeddings: async (data: any) => {
    const response = await axios.post(`${API_BASE_URL}/clustering`, data);
    return response.data;
  },

  // Visualization endpoints
  getVisualizationData: async (data: any) => {
    const response = await axios.post(`${API_BASE_URL}/visualization`, data);
    return response.data;
  },

  // Chip endpoints
  getChipUrl: (projectId: number, filename: string) => {
    return `${API_BASE_URL}/chip/${projectId}/${filename}`;
  },

  // Label suggestion endpoint
  suggestLabel: async (projectId: number, chipDescriptions: string[], existingLabels?: string[]) => {
    const requestData: any = {
      project_id: projectId,
      chip_descriptions: chipDescriptions
    };
    
    if (existingLabels && existingLabels.length > 0) {
      requestData.existing_labels = existingLabels;
    }
    
    const response = await axios.post(`${API_BASE_URL}/suggest-label`, requestData);
    return response.data;
  },

  // Label management endpoints
  createProjectLabel: async (projectId: number, labelData: any) => {
    const response = await axios.post(`${API_BASE_URL}/projects/${projectId}/labels`, labelData);
    return response.data;
  },

  getProjectLabels: async (projectId: number) => {
    const response = await axios.get(`${API_BASE_URL}/projects/${projectId}/labels`);
    return response.data;
  },

  // TODO update this
  updateAnnotationLabels: async (taskId: number, label_id: number, annotation_ids: any[]) => {
    const response = await axios.post(`${API_BASE_URL}/annotations/update`, {
      task_id: taskId,
      new_label_id: label_id,
      annotation_ids: annotation_ids
    });
    return response.data;
  },

};
