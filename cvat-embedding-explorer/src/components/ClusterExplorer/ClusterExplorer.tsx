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
  const [chipViewerVisible, setChipViewerVisible] = useState<boolean>(false);
  const [selectedChips, setSelectedChips] = useState<string[]>([]);
  const [zoom, setZoom] = useState<number>(1);

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
              display_dims: 2,
              feature_type: 'both'
            });

            // Fetch available labels from the project
            // In a real implementation, this would come from the API
            setAvailableLabels(['Person', 'Car', 'Bicycle', 'Tree', 'Building', 'Sign', 'Animal']);
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
        display_dims: values.display_dims,
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

      // Transform points data
      const points: Point[] = vizResult.points.map((point: any) => {
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

      setVisualizationData({
        points,
        clusters,
        dimensions: vizResult.dimensions
      });

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
  };

  const handleClusterSelection = (clusterId: number | null) => {
    setSelectedCluster(clusterId);
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

    setSelectedChips(chipIds);
    setChipViewerVisible(true);
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
      // In a real implementation, this would be an API call to update labels
      // For now, we'll just update the local state

      if (visualizationData) {
        const updatedClusters = [...visualizationData.clusters];

        if (selectedCluster !== null) {
          // Update cluster label
          const clusterIndex = updatedClusters.findIndex(c => c.id === selectedCluster);
          if (clusterIndex !== -1) {
            updatedClusters[clusterIndex] = {
              ...updatedClusters[clusterIndex],
              label: newLabel
            };
          }
        }

        setVisualizationData({
          ...visualizationData,
          clusters: updatedClusters
        });
      }

      message.success(`Applied label "${newLabel}" successfully`);
      setLabelModalVisible(false);
      setNewLabel('');
    } catch (error) {
      console.error('Error applying label:', error);
      message.error('Failed to apply label');
    }
  };

  const handleMergeClusters = () => {
    message.info('Merge clusters functionality would be implemented here');
    // This would involve an API call to merge clusters
  };

  const handleDeleteSelection = () => {
    message.info('Delete selection functionality would be implemented here');
    // This would involve an API call to remove points from the dataset
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

      <Tabs defaultActiveKey="visualization" className="cvat-cluster-explorer-tabs">
        <TabPane tab="Visualization" key="visualization">
          <Card className="cvat-cluster-explorer-card">
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
                  display_dims: 2,
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

                <Form.Item
                  name="display_dims"
                  label="Display Dimensions"
                  rules={[{ required: true, message: 'Required' }]}
                >
                  <Select>
                    <Option value={2}>2D</Option>
                    <Option value={3}>3D</Option>
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

            <Divider />

            <div className="cvat-cluster-explorer-visualization">
              <div className="cvat-cluster-visualization-toolbar">
                <div className="cvat-cluster-visualization-actions">
                  <Tooltip title="View selected chips">

                  </Tooltip>
                  <Tooltip title="Label selected points or cluster">
                    <Button
                      icon={<TagOutlined />}
                      onClick={handleLabelSelection}
                      disabled={selectedPoints.length === 0 && selectedCluster === null}
                    >
                      Label
                    </Button>
                  </Tooltip>
                  <Tooltip title="Merge selected clusters">
                    <Button
                      icon={<MergeCellsOutlined />}
                      onClick={handleMergeClusters}
                      disabled={selectedCluster === null}
                    >
                      Merge
                    </Button>
                  </Tooltip>
                  <Tooltip title="Delete selected points">
                    <Button
                      danger
                      icon={<DeleteOutlined />}
                      onClick={handleDeleteSelection}
                      disabled={selectedPoints.length === 0}
                    >
                      Delete
                    </Button>
                  </Tooltip>
                </div>

              </div>

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
                />
              ) : (
                <Empty description="No visualization data available" />
              )}
            </div>
          </Card>
        </TabPane>

        <TabPane tab="Analysis" key="analysis">
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

                  <Title level={4}>Clusters</Title>
                  <div className="cvat-cluster-explorer-clusters">
                    <table className="cvat-cluster-explorer-clusters-table">
                      <thead>
                        <tr>
                          <th>ID</th>
                          <th>Size</th>
                          <th>Label</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visualizationData.clusters
                          .filter(cluster => cluster.id !== -1)
                          .sort((a, b) => b.size - a.size)
                          .map(cluster => (
                            <tr
                              key={cluster.id}
                              className={selectedCluster === cluster.id ? 'selected' : ''}
                              onClick={() => handleClusterSelection(cluster.id)}
                            >
                              <td>{cluster.id}</td>
                              <td>{cluster.size}</td>
                              <td>
                                {cluster.label ? (
                                  <Tag color="blue">{cluster.label}</Tag>
                                ) : (
                                  <Tag color="gray">Unlabeled</Tag>
                                )}
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
                          ))}
                      </tbody>
                    </table>
                  </div>
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
            </Form.Item>
          </Form>
        </div>
      </Modal>

      {/* Chip Viewer Modal */}
      <Modal
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
        {selectedChips.length > 0 && (
          <ChipViewer
            projectId={parseInt(projectId)}
            chipIds={selectedChips}
          />
        )}
      </Modal>

      {/* Show chip grid for selected cluster */}
      {selectedCluster !== null && visualizationData && (
        <div className="cvat-cluster-chip-grid">
          {selectedPoints.map(pointId => {
            const point = visualizationData.points.find(p => p.id === pointId);
            if (!point) return null;

            return (
              <div key={point.id} className="cvat-cluster-chip">
                <Image
                  src={point.imageUrl}
                  alt={point.filename}
                  preview={false}
                />
                <div className="cvat-cluster-chip-info">
                  <div>Filename: {point.filename}</div>
                  <div>Cluster: {point.clusterId}</div>
                  <div>Description: {point.description}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default ClusterExplorer;