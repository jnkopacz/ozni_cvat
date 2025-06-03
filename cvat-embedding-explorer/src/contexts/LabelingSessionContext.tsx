import React, { createContext, useContext, useReducer, useEffect } from 'react';
import { api } from '../api/api';
import { LabelCreateRequest, AnnotationUpdate } from '../models/types';

export interface LabelingSession {
  projectId: number;
  totalChips: number;
  labeledChips: Set<string>;           // Chip IDs that have been labeled
  chipLabels: Map<string, string>;     // chipId -> label mapping
  clusterLabels: Map<number, string>;  // clusterId -> label mapping
  labelClusterMapping: Map<string, number>; // label -> cluster ID mapping (for reusing cluster IDs)
  chipClusterMapping: Map<string, number>; // chipId -> final cluster ID (for labeled chips)
  nextClusterId: number;               // Next available cluster ID for labeled groups
  progressPercentage: number;
  sessionStartTime: number;
  lastUpdated: number;
}

export enum ClusterState {
  UNLABELED = 'unlabeled',
  UNDER_REVIEW = 'reviewing',
  REFINED = 'refined',
  LABELED = 'labeled'
}

interface LabelingSessionState {
  session: LabelingSession | null;
  clusterStates: Map<number, ClusterState>;
  currentCluster: number | null;
  completionStatus: {
    isCompleting: boolean;
    completionProgress: number;
    completionError: string | null;
  };
}

type LabelingSessionAction =
  | { type: 'INIT_SESSION'; payload: { projectId: number; totalChips: number } }
  | { type: 'LOAD_SESSION'; payload: LabelingSession }
  | { type: 'MOVE_CHIP_TO_NOISE'; payload: { chipId: string } }
  | { type: 'LABEL_CHIPS'; payload: { chipIds: string[]; label: string } }
  | { type: 'LABEL_CLUSTER'; payload: { clusterId: number; label: string; chipIds: string[] } }
  | { type: 'SET_CLUSTER_STATE'; payload: { clusterId: number; state: ClusterState } }
  | { type: 'SET_CURRENT_CLUSTER'; payload: number | null }
  | { type: 'RESET_SESSION' }
  | { type: 'UPDATE_PROGRESS' }
  | { type: 'UPDATE_CLUSTERING'; payload: { totalChips: number } }
  | { type: 'CLEAR_NOISE_CLUSTER' }
  | { type: 'SET_COMPLETION_STATUS'; payload: { isCompleting: boolean; completionProgress?: number; completionError?: string } };

const initialState: LabelingSessionState = {
  session: null,
  clusterStates: new Map(),
  currentCluster: null,
  completionStatus: {
    isCompleting: false,
    completionProgress: 0,
    completionError: null,
  },
};

const labelingSessionReducer = (
  state: LabelingSessionState,
  action: LabelingSessionAction
): LabelingSessionState => {
  switch (action.type) {
    case 'INIT_SESSION':
      const newSession: LabelingSession = {
        projectId: action.payload.projectId,
        totalChips: action.payload.totalChips,
        labeledChips: new Set(),
        chipLabels: new Map(),
        clusterLabels: new Map(),
        labelClusterMapping: new Map(),
        chipClusterMapping: new Map(),
        nextClusterId: 10000, // Start labeled clusters at high number to avoid conflicts
        progressPercentage: 0,
        sessionStartTime: Date.now(),
        lastUpdated: Date.now(),
      };
      return {
        ...state,
        session: newSession,
        clusterStates: new Map(),
        currentCluster: null,
      };

    case 'LOAD_SESSION':
      return {
        ...state,
        session: {
          ...action.payload,
          labeledChips: new Set(Array.from(action.payload.labeledChips)),
          chipLabels: new Map(Array.from(action.payload.chipLabels)),
          clusterLabels: new Map(Array.from(action.payload.clusterLabels)),
          labelClusterMapping: new Map(Array.from(action.payload.labelClusterMapping || [])),
          chipClusterMapping: new Map(Array.from(action.payload.chipClusterMapping || [])),
        },
      };

    case 'MOVE_CHIP_TO_NOISE':
      if (!state.session) return state;
      const newChipClusterMapping = new Map(state.session.chipClusterMapping);
      newChipClusterMapping.set(action.payload.chipId, -1); // Move to noise cluster
      return {
        ...state,
        session: {
          ...state.session,
          chipClusterMapping: newChipClusterMapping,
          lastUpdated: Date.now(),
        },
      };

    case 'LABEL_CHIPS':
      if (!state.session) return state;
      const labelChipsNewLabeledChips = new Set(state.session.labeledChips);
      const labelChipsNewChipLabels = new Map(state.session.chipLabels);
      const labelChipsNewClusterLabels = new Map(state.session.clusterLabels);
      const labelChipsNewLabelClusterMapping = new Map(state.session.labelClusterMapping);
      const labelChipsUpdatedChipClusterMapping = new Map(state.session.chipClusterMapping);
      
      // Check if we already have a cluster ID for this label
      let labelChipsTargetClusterId = labelChipsNewLabelClusterMapping.get(action.payload.label);
      let labelChipsNextClusterId = state.session.nextClusterId;
      
      if (!labelChipsTargetClusterId) {
        // Create new cluster ID for this label
        labelChipsTargetClusterId = labelChipsNextClusterId;
        labelChipsNewLabelClusterMapping.set(action.payload.label, labelChipsTargetClusterId);
        labelChipsNewClusterLabels.set(labelChipsTargetClusterId, action.payload.label);
        labelChipsNextClusterId++;
      }

      // Add chips to labeled set and map chip IDs to labels and cluster
      action.payload.chipIds.forEach(chipId => {
        labelChipsNewLabeledChips.add(chipId);
        labelChipsNewChipLabels.set(chipId, action.payload.label);
        labelChipsUpdatedChipClusterMapping.set(chipId, labelChipsTargetClusterId!);
      });

      const labelChipsProgressPercentage = Math.round((labelChipsNewLabeledChips.size / state.session.totalChips) * 100);

      return {
        ...state,
        session: {
          ...state.session,
          labeledChips: labelChipsNewLabeledChips,
          chipLabels: labelChipsNewChipLabels,
          clusterLabels: labelChipsNewClusterLabels,
          labelClusterMapping: labelChipsNewLabelClusterMapping,
          chipClusterMapping: labelChipsUpdatedChipClusterMapping,
          nextClusterId: labelChipsNextClusterId,
          progressPercentage: labelChipsProgressPercentage,
          lastUpdated: Date.now(),
        },
      };

    case 'LABEL_CLUSTER':
      if (!state.session) return state;
      const newLabeledChips = new Set(state.session.labeledChips);
      const newChipLabels = new Map(state.session.chipLabels);
      const newClusterLabels = new Map(state.session.clusterLabels);
      const newLabelClusterMapping = new Map(state.session.labelClusterMapping);
      const updatedChipClusterMapping = new Map(state.session.chipClusterMapping);
      
      // Check if we already have a cluster ID for this label
      let targetClusterId = newLabelClusterMapping.get(action.payload.label);
      let nextClusterId = state.session.nextClusterId;
      
      if (!targetClusterId) {
        // Create new cluster ID for this label
        targetClusterId = nextClusterId;
        newLabelClusterMapping.set(action.payload.label, targetClusterId);
        newClusterLabels.set(targetClusterId, action.payload.label);
        nextClusterId++;
      }

      // Add chips to labeled set and map chip IDs to labels and cluster
      action.payload.chipIds.forEach(chipId => {
        newLabeledChips.add(chipId);
        newChipLabels.set(chipId, action.payload.label);
        updatedChipClusterMapping.set(chipId, targetClusterId!);
      });

      const progressPercentage = Math.round((newLabeledChips.size / state.session.totalChips) * 100);

      const newClusterStates = new Map(state.clusterStates);
      newClusterStates.set(action.payload.clusterId, ClusterState.LABELED);
      newClusterStates.set(targetClusterId, ClusterState.LABELED);

      return {
        ...state,
        session: {
          ...state.session,
          labeledChips: newLabeledChips,
          chipLabels: newChipLabels,
          clusterLabels: newClusterLabels,
          labelClusterMapping: newLabelClusterMapping,
          chipClusterMapping: updatedChipClusterMapping,
          nextClusterId,
          progressPercentage,
          lastUpdated: Date.now(),
        },
        clusterStates: newClusterStates,
      };

    case 'SET_CLUSTER_STATE':
      const updatedClusterStates = new Map(state.clusterStates);
      updatedClusterStates.set(action.payload.clusterId, action.payload.state);
      return {
        ...state,
        clusterStates: updatedClusterStates,
      };

    case 'SET_CURRENT_CLUSTER':
      return {
        ...state,
        currentCluster: action.payload,
      };

    case 'UPDATE_PROGRESS':
      if (!state.session) return state;
      const newProgressPercentage = Math.round(
        (state.session.labeledChips.size / state.session.totalChips) * 100
      );
      return {
        ...state,
        session: {
          ...state.session,
          progressPercentage: newProgressPercentage,
          lastUpdated: Date.now(),
        },
      };

    case 'CLEAR_NOISE_CLUSTER':
      if (!state.session) return state;
      const clearedChipClusterMapping = new Map(state.session.chipClusterMapping);
      
      // Remove all chips that are in noise cluster (-1)
      for (const [chipId, clusterId] of clearedChipClusterMapping.entries()) {
        if (clusterId === -1) {
          clearedChipClusterMapping.delete(chipId);
        }
      }
      
      return {
        ...state,
        session: {
          ...state.session,
          chipClusterMapping: clearedChipClusterMapping,
          lastUpdated: Date.now(),
        },
      };

    case 'UPDATE_CLUSTERING':
      if (!state.session) return state;
      return {
        ...state,
        session: {
          ...state.session,
          totalChips: action.payload.totalChips,
          lastUpdated: Date.now(),
        },
      };

    case 'SET_COMPLETION_STATUS':
      return {
        ...state,
        completionStatus: {
          isCompleting: action.payload.isCompleting,
          completionProgress: action.payload.completionProgress ?? state.completionStatus.completionProgress,
          completionError: action.payload.completionError ?? state.completionStatus.completionError,
        },
      };

    case 'RESET_SESSION':
      return initialState;

    default:
      return state;
  }
};

interface LabelingSessionContextType {
  state: LabelingSessionState;
  initSession: (projectId: number, totalChips: number) => void;
  moveChipToNoise: (chipId: string) => void;
  labelChips: (chipIds: string[], label: string) => void;
  labelCluster: (clusterId: number, label: string, chipIds: string[]) => void;
  setClusterState: (clusterId: number, state: ClusterState) => void;
  setCurrentCluster: (clusterId: number | null) => void;
  resetSession: () => void;
  saveSession: () => void;
  loadSession: () => void;
  updateClustering: (totalChips: number) => void;
  clearNoiseCluster: () => void;
  completeSession: () => Promise<void>;
  getClusterState: (clusterId: number) => ClusterState;
  isChipLabeled: (chipId: string) => boolean;
  getChipLabel: (chipId: string) => string | undefined;
  getClusterLabel: (clusterId: number) => string | undefined;
  getChipFinalCluster: (chipId: string) => number | undefined;
  isChipFinished: (chipId: string) => boolean;
  isChipInNoise: (chipId: string) => boolean;
  getSessionStats: () => {
    totalChips: number;
    labeledChips: number;
    remainingChips: number;
    progressPercentage: number;
    noiseChips: number;
    sessionDuration: number;
  };
}

const LabelingSessionContext = createContext<LabelingSessionContextType | undefined>(undefined);

export const LabelingSessionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, dispatch] = useReducer(labelingSessionReducer, initialState);

  // Auto-save session to localStorage
  useEffect(() => {
    if (state.session) {
      const sessionData = {
        ...state.session,
        labeledChips: Array.from(state.session.labeledChips),
        chipLabels: Array.from(state.session.chipLabels),
        clusterLabels: Array.from(state.session.clusterLabels),
        labelClusterMapping: Array.from(state.session.labelClusterMapping),
        chipClusterMapping: Array.from(state.session.chipClusterMapping),
      };
      localStorage.setItem(`labeling_session_${state.session.projectId}`, JSON.stringify(sessionData));
    }
  }, [state.session]);

  const initSession = (projectId: number, totalChips: number) => {
    dispatch({ type: 'INIT_SESSION', payload: { projectId, totalChips } });
  };

  const moveChipToNoise = (chipId: string) => {
    dispatch({ type: 'MOVE_CHIP_TO_NOISE', payload: { chipId } });
  };

  const labelChips = (chipIds: string[], label: string) => {
    dispatch({ type: 'LABEL_CHIPS', payload: { chipIds, label } });
  };

  const labelCluster = (clusterId: number, label: string, chipIds: string[]) => {
    dispatch({ type: 'LABEL_CLUSTER', payload: { clusterId, label, chipIds } });
  };

  const clearNoiseCluster = () => {
    dispatch({ type: 'CLEAR_NOISE_CLUSTER' });
  };

  const setClusterState = (clusterId: number, clusterState: ClusterState) => {
    dispatch({ type: 'SET_CLUSTER_STATE', payload: { clusterId, state: clusterState } });
  };

  const setCurrentCluster = (clusterId: number | null) => {
    dispatch({ type: 'SET_CURRENT_CLUSTER', payload: clusterId });
  };

  const resetSession = () => {
    dispatch({ type: 'RESET_SESSION' });
  };

  const updateClustering = (totalChips: number) => {
    dispatch({ type: 'UPDATE_CLUSTERING', payload: { totalChips } });
  };

  const saveSession = () => {
    if (state.session) {
      const sessionData = {
        ...state.session,
        labeledChips: Array.from(state.session.labeledChips),
        chipLabels: Array.from(state.session.chipLabels),
        clusterLabels: Array.from(state.session.clusterLabels),
        labelClusterMapping: Array.from(state.session.labelClusterMapping),
        chipClusterMapping: Array.from(state.session.chipClusterMapping),
      };
      localStorage.setItem(`labeling_session_${state.session.projectId}`, JSON.stringify(sessionData));
    }
  };

  const loadSession = () => {
    if (state.session) {
      const savedSession = localStorage.getItem(`labeling_session_${state.session.projectId}`);
      if (savedSession) {
        const sessionData = JSON.parse(savedSession);
        dispatch({ type: 'LOAD_SESSION', payload: sessionData });
      }
    }
  };

  const getClusterState = (clusterId: number): ClusterState => {
    return state.clusterStates.get(clusterId) || ClusterState.UNLABELED;
  };

  const isChipInNoise = (chipId: string): boolean => {
    return state.session?.chipClusterMapping.get(chipId) === -1 || false;
  };

  const isChipLabeled = (chipId: string): boolean => {
    return state.session?.labeledChips.has(chipId) || false;
  };

  const getChipLabel = (chipId: string): string | undefined => {
    return state.session?.chipLabels.get(chipId);
  };

  const getClusterLabel = (clusterId: number): string | undefined => {
    return state.session?.clusterLabels.get(clusterId);
  };

  const getChipFinalCluster = (chipId: string): number | undefined => {
    return state.session?.chipClusterMapping.get(chipId);
  };

  const isChipFinished = (chipId: string): boolean => {
    return state.session?.labeledChips.has(chipId) || false;
  };

  const getSessionStats = () => {
    if (!state.session) {
      return {
        totalChips: 0,
        labeledChips: 0,
        remainingChips: 0,
        progressPercentage: 0,
        noiseChips: 0,
        sessionDuration: 0,
      };
    }

    const sessionDuration = Date.now() - state.session.sessionStartTime;
    
    return {
      totalChips: state.session.totalChips,
      labeledChips: state.session.labeledChips.size,
      remainingChips: state.session.totalChips - state.session.labeledChips.size,
      progressPercentage: state.session.progressPercentage,
      noiseChips: Array.from(state.session.chipClusterMapping.values()).filter(id => id === -1).length,
      sessionDuration,
    };
  };

  // Parse chip ID to extract task ID and annotation ID
  // Format: task20_job20_frame10_anno92189.png
  const parseChipId = (chipId: string): { taskId: number; annotationId: number } | null => {
    const taskMatch = chipId.match(/task(\d+)_/);
    const annoMatch = chipId.match(/anno(\d+)/);
    
    if (taskMatch && annoMatch) {
      return {
        taskId: parseInt(taskMatch[1], 10),
        annotationId: parseInt(annoMatch[1], 10)
      };
    }
    
    return null;
  };

  const completeSession = async () => {
    if (!state.session) {
      throw new Error('No active session to complete');
    }

    try {
      dispatch({ type: 'SET_COMPLETION_STATUS', payload: { isCompleting: true, completionProgress: 0, completionError: undefined } });

      const projectId = state.session.projectId;
      const uniqueLabels = Array.from(new Set(state.session.chipLabels.values()));
      
      // Step 1: Get tasks for this project
      dispatch({ type: 'SET_COMPLETION_STATUS', payload: { isCompleting: true, completionProgress: 5 } });
      const tasksResponse = await api.getTasks(projectId);
      const taskIds = tasksResponse.map((task: any) => task.id);
      
      if (taskIds.length === 0) {
        throw new Error('No tasks found for this project');
      }
      
      // Step 2: Get existing project labels
      dispatch({ type: 'SET_COMPLETION_STATUS', payload: { isCompleting: true, completionProgress: 10 } });
      const existingLabelsResponse = await api.getProjectLabels(projectId);
      const existingLabelNames = new Set(existingLabelsResponse.labels.map((label: any) => label.name));
      
      // Step 3: Create new labels that don't exist
      const newLabels = uniqueLabels.filter(label => !existingLabelNames.has(label));
      const labelIdMapping = new Map<string, number>();
      
      // Add existing labels to mapping
      existingLabelsResponse.labels.forEach((label: any) => {
        labelIdMapping.set(label.name, label.id);
      });
      
      dispatch({ type: 'SET_COMPLETION_STATUS', payload: { isCompleting: true, completionProgress: 20 } });
      
      // Create new labels
      for (let i = 0; i < newLabels.length; i++) {
        const labelName = newLabels[i];
        const labelData: LabelCreateRequest = {
          name: labelName,
          color: `#${Math.floor(Math.random()*16777215).toString(16)}`, // Random color
        };
        
        const createResponse = await api.createProjectLabel(projectId, labelData);
        labelIdMapping.set(labelName, createResponse.label.id);
        
        const progress = 20 + (30 * (i + 1) / newLabels.length);
        dispatch({ type: 'SET_COMPLETION_STATUS', payload: { isCompleting: true, completionProgress: progress } });
      }
      
      // Step 4: Parse chip IDs and group annotations by task and label
      dispatch({ type: 'SET_COMPLETION_STATUS', payload: { isCompleting: true, completionProgress: 50 } });
      
      // Structure: Map<taskId, Map<labelName, annotationIds[]>>
      const taskLabelAnnotations = new Map<number, Map<string, number[]>>();
      
      for (const [chipId, label] of state.session.chipLabels.entries()) {
        const parsed = parseChipId(chipId);
        if (!parsed) {
          console.warn(`Could not parse chip ID: ${chipId}`);
          continue;
        }
        
        const { taskId, annotationId } = parsed;
        
        if (!taskLabelAnnotations.has(taskId)) {
          taskLabelAnnotations.set(taskId, new Map());
        }
        
        const taskLabels = taskLabelAnnotations.get(taskId)!;
        if (!taskLabels.has(label)) {
          taskLabels.set(label, []);
        }
        
        taskLabels.get(label)!.push(annotationId);
      }
      
      console.log('Grouped annotations by task and label:', taskLabelAnnotations);
      
      // Step 5: Update annotations for each task and label combination
      const totalUpdates = Array.from(taskLabelAnnotations.values())
        .reduce((sum, taskLabels) => sum + taskLabels.size, 0);
      let completedUpdates = 0;
      
      for (const [taskId, taskLabels] of taskLabelAnnotations.entries()) {
        for (const [labelName, annotationIds] of taskLabels.entries()) {
          const labelId = labelIdMapping.get(labelName);
          if (!labelId) {
            throw new Error(`Label ID not found for label: ${labelName}`);
          }
          
          console.log(`Updating task ${taskId}, label "${labelName}" (ID: ${labelId}), annotations: [${annotationIds.join(', ')}]`);
          
          // Apply updates
          await api.updateAnnotationLabels(taskId, labelId, annotationIds);
          
          completedUpdates++;
          const progress = 50 + (40 * completedUpdates / totalUpdates);
          dispatch({ type: 'SET_COMPLETION_STATUS', payload: { isCompleting: true, completionProgress: progress } });
        }
      }
      
      // Step 6: Complete
      dispatch({ type: 'SET_COMPLETION_STATUS', payload: { isCompleting: true, completionProgress: 100 } });
      
      // Reset completion status after a short delay
      setTimeout(() => {
        dispatch({ type: 'SET_COMPLETION_STATUS', payload: { isCompleting: false, completionProgress: 0, completionError: undefined } });
      }, 2000);
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      dispatch({ type: 'SET_COMPLETION_STATUS', payload: { isCompleting: false, completionProgress: 0, completionError: errorMessage } });
      throw error;
    }
  };

  return (
    <LabelingSessionContext.Provider
      value={{
        state,
        initSession,
        moveChipToNoise,
        labelChips,
        labelCluster,
        setClusterState,
        setCurrentCluster,
        resetSession,
        saveSession,
        loadSession,
        updateClustering,
        clearNoiseCluster,
        completeSession,
        getClusterState,
        isChipLabeled,
        getChipLabel,
        getClusterLabel,
        getChipFinalCluster,
        isChipFinished,
        isChipInNoise,
        getSessionStats,
      }}
    >
      {children}
    </LabelingSessionContext.Provider>
  );
};

export const useLabelingSession = () => {
  const context = useContext(LabelingSessionContext);
  if (context === undefined) {
    throw new Error('useLabelingSession must be used within a LabelingSessionProvider');
  }
  return context;
};
