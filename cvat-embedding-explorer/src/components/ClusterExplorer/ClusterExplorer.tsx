// src/components/ClusterExplorer/ClusterExplorer.tsx
import React, { useEffect, useState, useRef } from 'react';
import { useParams, useHistory } from 'react-router-dom';
import {
  Card,
  Button,
  Typography,
  Spin,
  Empty,
  Tabs,
  Form,
  InputNumber,
  Select,
  Divider,
  Alert,
  Row,
  Col,
  Space,
  Tag,
  Input,
  Tooltip,
  Modal,
  Checkbox,
  message,
  Image
} from 'antd';
import {
  ArrowLeftOutlined,
  SettingOutlined,
  ReloadOutlined,
  ZoomInOutlined,
  ZoomOutOutlined,
  TagOutlined,
  MergeCellsOutlined,
  DeleteOutlined,
  SaveOutlined,
  EyeOutlined,
  PlusOutlined
} from '@ant-design/icons';
import { api } from '../../api/api';
import { Project, EmbeddingStatus, ClusteringRequest } from '../../models/types';
import ClusterVisualization from './ClusterVisualization';
import ChipViewer from './ChipViewer';
import SessionProgressTracker from './SessionProgressTracker';
import { useLabelingSession, ClusterState } from '../../contexts/LabelingSessionContext';
import './styles.scss';

const { Title, Text, Paragraph } = Typography;
const { TabPane } = Tabs;
const { Option } = Select;
const { Search } = Input;

interface RouteParams {
  projectId: string;
}

interface Cluster {
  id: number;
  size: number;
  label: string | null;
  color: string;
}

interface Point {
  id: string; // Unique identifier for the point (chip filename)
  x: number;
  y: number;
  z?: number;
  clusterId: number;
  selected: boolean;
  filename: string;
  description: string;
  imageUrl?: string;
}

interface VisualizationData {
  points: Point[];
  clusters: Cluster[];
  dimensions: number;
}

const ClusterExplorer: React.FC = () => {
  const { projectId } = useParams<RouteParams>();
  const history = useHistory();
  const [form] = Form.useForm();
  const [project, setProject] = useState<Project | null>(null);
  const [embeddingStatus, setEmbeddingStatus] = useState<EmbeddingStatus | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [clusteringLoading, setClusteringLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [visualizationData, setVisualizationData] = useState<VisualizationData | null>(null);
  const [selectedPoints, setSelectedPoints] = useState<string[]>([]);
  const [selectedCluster, setSelectedCluster] = useState<number | null>(null);
  const [labelModalVisible, setLabelModalVisible] = useState<boolean>(false);
  const [newLabel, setNewLabel] = useState<string>('');
  const [availableLabels, setAvailableLabels] = useState<string[]>([]);
  const [zoom, setZoom] = useState<number>(1);
  const [searchText, setSearchText] = useState<string>('');
  const [chipViewerVisible, setChipViewerVisible] = useState<boolean>(false);
  const [isSearchMode, setIsSearchMode] = useState<boolean>(false);
  const [suggestingLabel, setSuggestingLabel] = useState<boolean>(false);

  // Session management
  const {
    initSession,
    labelChips,
    labelCluster,
    setClusterState,
    setCurrentCluster,
    getClusterState,
    getClusterLabel,
    isChipFinished,
    isChipInNoise,
    getChipFinalCluster,
    updateClustering,
    clearNoiseCluster,
    moveChipToNoise,
    state: sessionState
  } = useLabelingSession();

  // Fetch project data and embedding status
  useEffect(() => {
    const fetchProjectData = async () => {
      setLoading(true);
      try {
        // Fetch project details
        const projects = await api.getProjects();
        const projectData = projects.find((p: Project) => p.id === parseInt(projectId));
        if (projectData) {
          setProject(projectData);

          // Check embedding status
          const status = await api.checkEmbeddings(parseInt(projectId));
          setEmbeddingStatus(status);

          if (!status.exists) {
            setError('Embeddings are not available for this project. Please generate embeddings first.');
          } else {
            // If embeddings exist, run initial clustering with default parameters
            await runClustering({
              min_cluster_size: 5,
              min_samples: 5,
              clustering_dims: 5,
              reduction_method: 'umap',
              display_dims: 3,
              feature_type: 'both'
            });

            // Fetch available labels from the project
            const labels = await api.getProjectLabels(parseInt(projectId));
            const label_names = labels['labels'].map((label: any) => label.name);
            setAvailableLabels(label_names); //This is just the starting point, we will update this as we label chips

            // TODO set labels as done if they are equal to some value (e.g. vehicle)
          }
        } else {
          setError('Project not found');
        }
      } catch (error) {
        console.error('Error fetching project data:', error);
        setError('Failed to load project data');
      } finally {
        setLoading(false);
      }
    };

    fetchProjectData();
  }, [projectId]);

  const runClustering = async (values: any) => {
    try {
      setClusteringLoading(true);

      // Clear noise cluster when re-running clustering
      clearNoiseCluster();

      const clusteringRequest: ClusteringRequest = {
        project_id: parseInt(projectId),
        min_cluster_size: values.min_cluster_size,
        min_samples: values.min_samples,
        clustering_dims: values.clustering_dims,
        reduction_method: values.reduction_method,
        feature_type: values.feature_type
      };

      // Call the clustering API
      const clusteringResult = await api.clusterEmbeddings(clusteringRequest);

      // After clustering, get visualization data
      const visualizationRequest = {
        project_id: parseInt(projectId),
        display_dims: 3, // Always use 3D
        reduction_method: values.reduction_method,
        feature_type: values.feature_type
      };

      const vizResult = await api.getVisualizationData(visualizationRequest);

      // Transform the API response into our visualization data format
      const clusters: Cluster[] = [];
      const clusterMap = new Map<number, number>();

      // Create clusters from the points data
      vizResult.points.forEach((point: any) => {
        const clusterId = point.cluster;
        if (clusterId >= 0 && !clusterMap.has(clusterId)) {
          const color = getClusterColor(clusterId);
          clusterMap.set(clusterId, clusters.length);
          clusters.push({
            id: clusterId,
            size: 1,
            label: null,
            color
          });
        } else if (clusterId >= 0) {
          clusters[clusterMap.get(clusterId)!].size++;
        }
      });

      // Transform points data, filtering out finished/labeled chips
      const allPoints: Point[] = vizResult.points.map((point: any) => {
        return {
          id: point.filename,
          x: point.coordinates[0],
          y: point.coordinates[1],
          z: vizResult.dimensions > 2 ? point.coordinates[2] : undefined,
          clusterId: point.cluster,
          selected: false,
          filename: point.filename,
          description: point.description,
          imageUrl: api.getChipUrl(parseInt(projectId), point.filename)
        };
      });

      // Filter out finished chips from visualization
      // Since we cleared the noise cluster, all remaining chips should use their new cluster assignments
      const points = allPoints.filter(point => !isChipFinished(point.filename));

      setVisualizationData({
        points, // Only show unlabeled points in main visualization
        clusters,
        dimensions: vizResult.dimensions
      });

      // Initialize session if not already done, or update with new chip count
      if (!sessionState.session) {
        initSession(parseInt(projectId), allPoints.length);
      } else {
        updateClustering(allPoints.length);
      }

      // Reset selections
      setSelectedPoints([]);
      setSelectedCluster(null);

      setError(null);
    } catch (error) {
      console.error('Error running clustering:', error);
      setError('Failed to run clustering');
    } finally {
      setClusteringLoading(false);
    }
  };

  // Helper function to get a color for a cluster
  const getClusterColor = (clusterId: number): string => {
    const colors = ['#1890ff', '#52c41a', '#faad14', '#f5222d', '#722ed1', '#13c2c2', '#fa8c16', '#eb2f96'];
    return colors[clusterId % colors.length];
  };

  const handleBackToProjects = () => {
    history.push('/');
  };

  const handleRunClusteringSubmit = (values: any) => {
    runClustering(values);
  };

  const handlePointSelection = (points: string[]) => {
    setSelectedPoints(points);
    if (points.length > 0) {
      if (points.length > 100) {
        points = points.slice(0, 100);
      }
      setChipViewerVisible(true);
    } else {
      setChipViewerVisible(false);
    }
  };

  const handleClusterSelection = (clusterId: number | null) => {
    setSelectedCluster(clusterId);
    setCurrentCluster(clusterId);

    if (clusterId !== null) {
      // Set cluster state to under review when selected
      const currentState = getClusterState(clusterId);
      if (currentState === ClusterState.UNLABELED) {
        setClusterState(clusterId, ClusterState.UNDER_REVIEW);
      }

      // Get all points in the cluster (excluding finished ones)
      if (visualizationData) {
        const clusterPoints = visualizationData.points
          .filter(p => p.clusterId === clusterId && !isChipFinished(p.filename))
          .map(p => p.filename);
        setSelectedPoints(clusterPoints);
        setChipViewerVisible(true);
      }
    }
  };

  const handleViewChips = () => {
    if (!visualizationData) return;

    let chipIds: string[] = [];

    if (selectedCluster !== null) {
      // Get all points in the selected cluster
      chipIds = visualizationData.points
        .filter(p => p.clusterId === selectedCluster)
        .map(p => p.filename);
    } else if (selectedPoints.length > 0) {
      // Get selected points
      chipIds = selectedPoints;
    }

    if (chipIds.length === 0) {
      message.warning('Please select points or a cluster to view chips');
      return;
    }

    // Limit the number of chips to display to avoid performance issues
    if (chipIds.length > 100) {
      message.info(`Showing first 100 of ${chipIds.length} chips`);
      chipIds = chipIds.slice(0, 100);
    }

    setSelectedPoints(chipIds);
  };

  const handleLabelSelection = () => {
    if (selectedPoints.length > 0 || selectedCluster !== null) {
      setLabelModalVisible(true);
    } else {
      message.warning('Please select points or a cluster first');
    }
  };

  const handleApplyLabel = async () => {
    if (!newLabel) {
      message.warning('Please enter a label');
      return;
    }

    try {
      if (isSearchMode || (selectedCluster === null && selectedPoints.length > 0) || selectedCluster === -1) {
        // Search mode, individual chip selection, or noise cluster - label only the selected chips
        const chipsToLabel = selectedPoints.filter(id => !isChipFinished(id));

        // Apply label to specific chips
        labelChips(chipsToLabel, newLabel);

        // Remove labeled points from visualization
        if (visualizationData) {
          const remainingPoints = visualizationData.points.filter(
            p => !chipsToLabel.includes(p.filename)
          );

          setVisualizationData({
            ...visualizationData,
            points: remainingPoints
          });
        }

        message.success(`Applied label "${newLabel}" to ${chipsToLabel.length} selected chips`);
      } else if (visualizationData && selectedCluster !== null && selectedCluster !== -1) {
        // Cluster mode - label entire cluster
        const clusterChips = visualizationData.points
          .filter(p => p.clusterId === selectedCluster && !isChipInNoise(p.filename))
          .map(p => p.filename);

        // Apply label through session context (this creates new cluster ID or reuses existing)
        labelCluster(selectedCluster, newLabel, clusterChips);

        // Update cluster state to labeled
        setClusterState(selectedCluster, ClusterState.LABELED);

        // Remove labeled points from visualization (they're now finished)
        const remainingPoints = visualizationData.points.filter(
          p => !(p.clusterId === selectedCluster && !isChipInNoise(p.filename))
        );

        // Update clusters - remove the labeled cluster or reduce its size
        const updatedClusters = visualizationData.clusters.map(cluster => {
          if (cluster.id === selectedCluster) {
            const remainingSize = remainingPoints.filter(p => p.clusterId === selectedCluster).length;
            if (remainingSize === 0) {
              return null; // Mark for removal
            }
            return {
              ...cluster,
              size: remainingSize
            };
          }
          return cluster;
        }).filter(cluster => cluster !== null) as Cluster[];

        setVisualizationData({
          ...visualizationData,
          points: remainingPoints,
          clusters: updatedClusters
        });

        message.success(`Applied label "${newLabel}" to cluster ${selectedCluster} (${clusterChips.length} chips)`);
      }

      // Add to available labels if it's new
      if (!availableLabels.includes(newLabel)) {
        setAvailableLabels([...availableLabels, newLabel]);
      }

      setLabelModalVisible(false);
      setNewLabel('');
      setSelectedCluster(null);
      setSelectedPoints([]);
      setChipViewerVisible(false);
      setIsSearchMode(false);
    } catch (error) {
      console.error('Error applying label:', error);
      message.error('Failed to apply label');
    }
  };

  const handleMergeClusters = () => {
    message.info('Merge clusters functionality would be implemented here');
    // This would involve an API call to merge clusters
  };

  const handleRefineCluster = () => {
    if (selectedCluster !== null) {
      setClusterState(selectedCluster, ClusterState.REFINED);
      message.success('Cluster marked as refined and ready for labeling');
    }
  };

  const handleChipMoveToNoise = (chipId: string) => {
    // Update selected points to remove chip moved to noise
    setSelectedPoints(prev => prev.filter(id => id !== chipId));

    // Update visualization to move chip to noise cluster
    if (visualizationData) {
      const updatedPoints = visualizationData.points.map(point => {
        if (point.filename === chipId) {
          return { ...point, clusterId: -1 };
        }
        return point;
      });

      setVisualizationData({
        ...visualizationData,
        points: updatedPoints
      });
    }
  };

  const getClusterStateLabel = (clusterId: number): string => {
    const state = getClusterState(clusterId);
    switch (state) {
      case ClusterState.UNLABELED: return 'Unlabeled';
      case ClusterState.UNDER_REVIEW: return 'Under Review';
      case ClusterState.REFINED: return 'Refined';
      case ClusterState.LABELED: return 'Labeled';
      default: return 'Unknown';
    }
  };

  const getClusterStateColor = (clusterId: number): string => {
    const state = getClusterState(clusterId);
    switch (state) {
      case ClusterState.UNLABELED: return 'default';
      case ClusterState.UNDER_REVIEW: return 'processing';
      case ClusterState.REFINED: return 'warning';
      case ClusterState.LABELED: return 'success';
      default: return 'default';
    }
  };

  const handleZoomIn = () => {
    setZoom(prev => Math.min(prev + 0.1, 2));
  };

  const handleZoomOut = () => {
    setZoom(prev => Math.max(prev - 0.1, 0.5));
  };

  const handleResetZoom = () => {
    setZoom(1);
  };

  const handleSearch = (value: string) => {
    if (!visualizationData || !value.trim()) {
      setIsSearchMode(false);
      setSearchText('');
      handlePointSelection([]);
      return;
    }

    setSearchText(value); // Store the search text for display
    const searchLower = value.toLowerCase();
    const matchingPoints = visualizationData.points
      .filter(point =>
        point.filename.toLowerCase().includes(searchLower) ||
        point.description.toLowerCase().includes(searchLower)
      )
      .map(point => point.filename); // Use filename as the ID

    if (matchingPoints.length > 0) {
      setIsSearchMode(true);
      setSelectedCluster(null); // Clear cluster selection in search mode
      setSelectedPoints(matchingPoints);
      setChipViewerVisible(true);
      message.info(`Found ${matchingPoints.length} matching chips`);
    } else {
      setIsSearchMode(false);
      setSelectedPoints([]);
      setChipViewerVisible(false);
      message.warning('No chips found matching your search');
    }
  };

  const handleSuggestLabel = async () => {
    if (!visualizationData || selectedPoints.length === 0) {
      message.warning('Please select chips first');
      return;
    }

    setSuggestingLabel(true);

    try {
      // Get descriptions for selected chips (limit to 10)
      const chipDescriptions = selectedPoints
        .slice(0, 10)
        .map(chipId => {
          const point = visualizationData.points.find(p => p.filename === chipId);
          return point?.description || '';
        })
        .filter(desc => desc.length > 0);

      if (chipDescriptions.length === 0) {
        message.warning('No descriptions available for selected chips');
        return;
      }

      // Call the suggest label API with existing labels
      const response = await api.suggestLabel(parseInt(projectId), chipDescriptions, availableLabels);

      if (response.suggested_label) {
        setNewLabel(response.suggested_label);
        message.success(`Suggested label: "${response.suggested_label}"`);
      } else {
        message.warning('Could not generate a label suggestion');
      }
    } catch (error) {
      console.error('Error suggesting label:', error);
      message.error('Failed to suggest label. Please try again.');
    } finally {
      setSuggestingLabel(false);
    }
  };

  if (loading) {
    return (
      <div className="cvat-cluster-explorer-loading">
        <Spin size="large" />
        <Text>Loading project data...</Text>
      </div>
    );
  }

  if (error) {
    return (
      <div className="cvat-cluster-explorer-error">
        <Alert
          message="Error"
          description={error}
          type="error"
          showIcon
        />
        <Button
          type="primary"
          onClick={handleBackToProjects}
          style={{ marginTop: 16 }}
        >
          Back to Projects
        </Button>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="cvat-cluster-explorer-not-found">
        <Empty description="Project not found" />
        <Button
          type="primary"
          onClick={handleBackToProjects}
          style={{ marginTop: 16 }}
        >
          Back to Projects
        </Button>
      </div>
    );
  }

  return (
    <div className="cvat-cluster-explorer">
      <div className="cvat-cluster-explorer-header">
        <Button type="link" onClick={handleBackToProjects}>
          <ArrowLeftOutlined /> Back to Projects
        </Button>
        <Title level={2}>{project.name} - Cluster Explorer</Title>
      </div>

      {/* Session Progress Tracker */}
      <SessionProgressTracker />

      <Tabs defaultActiveKey="visualization" className="cvat-cluster-explorer-tabs">
        <TabPane tab="Visualization" key="visualization">
          <Card className="cvat-cluster-explorer-card">
            <div className="cvat-cluster-explorer-layout">
              <div className="cvat-cluster-explorer-controls">
                <Title level={4}>Clustering Settings</Title>
                <Form
                  form={form}
                  layout="vertical"
                  initialValues={{
                    min_cluster_size: 5,
                    min_samples: 5,
                    clustering_dims: 5,
                    reduction_method: 'umap',
                    display_dims: 3,
                    feature_type: 'both'
                  }}
                  onFinish={handleRunClusteringSubmit}
                >
                  <Form.Item
                    name="min_cluster_size"
                    label="Min Cluster Size"
                    rules={[{ required: true, message: 'Required' }]}
                  >
                    <InputNumber min={2} max={100} />
                  </Form.Item>

                  <Form.Item
                    name="min_samples"
                    label="Min Samples"
                    rules={[{ required: true, message: 'Required' }]}
                  >
                    <InputNumber min={1} max={100} />
                  </Form.Item>

                  <Form.Item
                    name="clustering_dims"
                    label="Clustering Dimensions"
                    rules={[{ required: true, message: 'Required' }]}
                  >
                    <InputNumber min={2} max={50} />
                  </Form.Item>

                  <Form.Item
                    name="reduction_method"
                    label="Reduction Method"
                    rules={[{ required: true, message: 'Required' }]}
                  >
                    <Select>
                      <Option value="pca">PCA</Option>
                      <Option value="umap">UMAP</Option>
                    </Select>
                  </Form.Item>

                  <Form.Item
                    name="feature_type"
                    label="Feature Type"
                    rules={[{ required: true, message: 'Required' }]}
                  >
                    <Select>
                      <Option value="image">Visual Features</Option>
                      <Option value="text">Contextual Features</Option>
                      <Option value="both">Both</Option>
                    </Select>
                  </Form.Item>

                  <Form.Item className="form-actions">
                    <Button
                      type="primary"
                      htmlType="submit"
                      loading={clusteringLoading}
                      icon={<ReloadOutlined />}
                    >
                      Run Clustering
                    </Button>
                  </Form.Item>
                </Form>
              </div>

              <div className="cvat-cluster-explorer-visualization">
              {clusteringLoading ? (
                <div className="cvat-cluster-explorer-loading">
                  <Spin size="large" />
                  <Text>Running clustering...</Text>
                </div>
              ) : visualizationData ? (
                <ClusterVisualization
                  data={visualizationData}
                  zoom={zoom}
                  onPointSelection={handlePointSelection}
                  onClusterSelection={handleClusterSelection}
                  selectedPoints={selectedPoints}
                  selectedCluster={selectedCluster}
                  projectId={parseInt(projectId)}
                  onSearch={handleSearch}
                  searchText={searchText}
                />
              ) : (
                <Empty description="No visualization data available" />
              )}
              </div>
            </div>
          </Card>
        </TabPane>

        <TabPane tab="Summary" key="analysis">
          <Card className="cvat-cluster-explorer-card">
            <div className="cvat-cluster-explorer-analysis">
              {visualizationData ? (
                <>
                  <div className="cvat-cluster-explorer-stats">
                    <Title level={4}>Clustering Statistics</Title>
                    <div className="cvat-cluster-explorer-stats-grid">
                      <div className="cvat-cluster-explorer-stat-card">
                        <div className="cvat-cluster-explorer-stat-value">
                          {visualizationData.points.length}
                        </div>
                        <div className="cvat-cluster-explorer-stat-label">
                          Total Points
                        </div>
                      </div>
                      <div className="cvat-cluster-explorer-stat-card">
                        <div className="cvat-cluster-explorer-stat-value">
                          {visualizationData.clusters.filter(c => c.id !== -1).length}
                        </div>
                        <div className="cvat-cluster-explorer-stat-label">
                          Clusters
                        </div>
                      </div>
                      <div className="cvat-cluster-explorer-stat-card">
                        <div className="cvat-cluster-explorer-stat-value">
                          {visualizationData.clusters.find(c => c.id === -1)?.size || 0}
                        </div>
                        <div className="cvat-cluster-explorer-stat-label">
                          Noise Points
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Active Clusters */}
                  <Title level={4}>Active Clusters (Unlabeled)</Title>
                  <div className="cvat-cluster-explorer-clusters">
                    <table className="cvat-cluster-explorer-clusters-table">
                      <thead>
                        <tr>
                          <th>ID</th>
                          <th>Size</th>
                          <th>State</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {/* Regular clusters */}
                        {visualizationData.clusters
                          .filter(cluster => cluster.id !== -1)
                          .sort((a, b) => {
                            // Calculate actual current size based on visualization data
                            const aCurrentSize = visualizationData.points.filter(p => p.clusterId === a.id).length;
                            const bCurrentSize = visualizationData.points.filter(p => p.clusterId === b.id).length;
                            return bCurrentSize - aCurrentSize;
                          })
                          .filter(cluster => {
                            // Only show clusters that still have points
                            const currentSize = visualizationData.points.filter(p => p.clusterId === cluster.id).length;
                            return currentSize > 0;
                          })
                          .map(cluster => {
                            const currentSize = visualizationData.points.filter(p => p.clusterId === cluster.id).length;
                            return (
                              <tr
                                key={cluster.id}
                                className={selectedCluster === cluster.id ? 'selected' : ''}
                                onClick={() => handleClusterSelection(cluster.id)}
                              >
                                <td>{cluster.id}</td>
                                <td>{currentSize}</td>
                                <td>
                                  <Tag color={getClusterStateColor(cluster.id)}>
                                    {getClusterStateLabel(cluster.id)}
                                  </Tag>
                                </td>
                                <td>
                                  <Space>
                                    <Button
                                      size="small"
                                      icon={<EyeOutlined />}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleClusterSelection(cluster.id);
                                        handleViewChips();
                                      }}
                                    />
                                    <Button
                                      size="small"
                                      icon={<TagOutlined />}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleClusterSelection(cluster.id);
                                        handleLabelSelection();
                                      }}
                                    />
                                  </Space>
                                </td>
                              </tr>
                            );
                          })}
                        {/* Noise cluster (-1) */}
                        {(() => {
                          const noiseSize = visualizationData.points.filter(p => p.clusterId === -1).length;
                          return noiseSize > 0 ? (
                            <tr
                              key={-1}
                              className={selectedCluster === -1 ? 'selected' : ''}
                              onClick={() => handleClusterSelection(-1)}
                            >
                              <td>-1 (Noise)</td>
                              <td>{noiseSize}</td>
                              <td>
                                <Tag color="orange">Noise</Tag>
                              </td>
                              <td>
                                <Space>
                                  <Button
                                    size="small"
                                    icon={<EyeOutlined />}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleClusterSelection(-1);
                                      handleViewChips();
                                    }}
                                  />
                                  <Button
                                    size="small"
                                    icon={<TagOutlined />}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleClusterSelection(-1);
                                      handleLabelSelection();
                                    }}
                                  />
                                </Space>
                              </td>
                            </tr>
                          ) : null;
                        })()}
                      </tbody>
                    </table>
                  </div>

                  {/* Finished/Labeled Clusters */}
                  {sessionState.session && sessionState.session.clusterLabels.size > 0 && (
                    <>
                      <Divider />
                      <Title level={4}>Labeled Clusters (Finished)</Title>
                      <div className="cvat-cluster-explorer-clusters">
                        <table className="cvat-cluster-explorer-clusters-table">
                          <thead>
                            <tr>
                              <th>Cluster ID</th>
                              <th>Label</th>
                              <th>Chip Count</th>
                              <th>Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {Array.from(sessionState.session.clusterLabels.entries())
                              .sort((a, b) => {
                                // Count chips in each labeled cluster
                                const aCount = Array.from(sessionState.session!.chipClusterMapping.values())
                                  .filter(clusterId => clusterId === a[0]).length;
                                const bCount = Array.from(sessionState.session!.chipClusterMapping.values())
                                  .filter(clusterId => clusterId === b[0]).length;
                                return bCount - aCount;
                              })
                              .map(([clusterId, label]) => {
                                const chipCount = Array.from(sessionState.session!.chipClusterMapping.values())
                                  .filter(id => id === clusterId).length;
                                return (
                                  <tr key={clusterId}>
                                    <td>{clusterId}</td>
                                    <td>
                                      <Tag color="green">{label}</Tag>
                                    </td>
                                    <td>{chipCount}</td>
                                    <td>
                                      <Tag color="success">Completed</Tag>
                                    </td>
                                  </tr>
                                );
                              })}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                </>
              ) : (
                <Empty description="Run clustering to see analysis" />
              )}
            </div>
          </Card>
        </TabPane>
      </Tabs>

      {/* Label Modal */}
      <Modal
        title="Apply Label"
        open={labelModalVisible}
        onOk={handleApplyLabel}
        onCancel={() => setLabelModalVisible(false)}
        okText="Apply"
        cancelText="Cancel"
        centered
        width={500}
      >
        <div className="cvat-cluster-explorer-label-modal">
          <Paragraph>
            {selectedCluster !== null ? (
              `Applying label to Cluster ${selectedCluster} (${
                visualizationData?.clusters.find(c => c.id === selectedCluster)?.size || 0
              } points)`
            ) : (
              `Applying label to ${selectedPoints.length} selected points`
            )}
          </Paragraph>

          <Form layout="vertical">
            <Form.Item label="Select Label">
              <Space.Compact style={{ width: '100%' }}>
                <Select
                  value={newLabel}
                  onChange={setNewLabel}
                  style={{ width: '100%' }}
                  placeholder="Select a label"
                  dropdownRender={menu => (
                    <>
                      {menu}
                      <Divider style={{ margin: '8px 0' }} />
                      <Space style={{ padding: '0 8px 4px' }}>
                        <Input
                          placeholder="Add new label"
                          value={newLabel}
                          onChange={e => setNewLabel(e.target.value)}
                        />
                        <Button
                          type="text"
                          icon={<PlusOutlined />}
                          onClick={() => {
                            if (newLabel && !availableLabels.includes(newLabel)) {
                              setAvailableLabels([...availableLabels, newLabel]);
                            }
                          }}
                        >
                          Add
                        </Button>
                      </Space>
                    </>
                  )}
                >
                  {availableLabels.map(label => (
                    <Option key={label} value={label}>{label}</Option>
                  ))}
                </Select>
              </Space.Compact>
            </Form.Item>

            <Form.Item>
              <Space>
                <Button
                  type="default"
                  icon={<PlusOutlined />}
                  loading={suggestingLabel}
                  onClick={handleSuggestLabel}
                  disabled={selectedPoints.length === 0}
                >
                  {suggestingLabel ? 'Suggesting...' : 'Suggest'}
                </Button>
                <Text type="secondary">
                  AI will analyze selected chips and suggest a label based on existing labels
                </Text>
              </Space>
            </Form.Item>
          </Form>
        </div>
      </Modal>

      {/* Chip Viewer Modal */}
      {/* <Modal
        title="Chip Viewer"
        open={chipViewerVisible}
        onCancel={() => setChipViewerVisible(false)}
        width={800}
        footer={[
          <Button key="close" onClick={() => setChipViewerVisible(false)}>
            Close
          </Button>
        ]}
      >
        {selectedPoints.length > 0 && (
          <ChipViewer
            projectId={parseInt(projectId)}
            chipIds={selectedPoints}
          />
        )}
      </Modal> */}

      {/* Enhanced Chip Viewer for selected cluster or search results */}
      {chipViewerVisible && selectedPoints.length > 0 && (
        <Card
          title={
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>
                {isSearchMode
                  ? `Search Results (${selectedPoints.length} chips)`
                  : selectedCluster !== null
                    ? `Cluster ${selectedCluster} - ${getClusterStateLabel(selectedCluster)} (${selectedPoints.length} chips)`
                    : `Selected Chips (${selectedPoints.length})`
                }
              </span>
              <Tooltip title="Label selected points or cluster">
                <Button
                  type="primary"
                  icon={<TagOutlined />}
                  onClick={handleLabelSelection}
                  disabled={selectedPoints.length === 0 && selectedCluster === null}
                >
                  Label
                </Button>
              </Tooltip>
            </div>
          }
          style={{ marginTop: 16 }}
        >

          <ChipViewer
            projectId={parseInt(projectId)}
            chipIds={selectedPoints}
            clusterId={selectedCluster || -1}
            onChipMoveToNoise={handleChipMoveToNoise}
            chipData={visualizationData ?
              Object.fromEntries(
                visualizationData.points.map(point => [
                  point.filename,
                  { filename: point.filename, description: point.description }
                ])
              ) : undefined
            }
          />
        </Card>
      )}
    </div>
  );
};

export default ClusterExplorer;
