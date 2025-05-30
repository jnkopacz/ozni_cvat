// src/components/ProjectsList/ProjectsList.tsx
import React, { useEffect, useState } from 'react';
import { useHistory } from 'react-router-dom';
import { Table, Button, Space, Tag, Typography, Tooltip, message } from 'antd';
import {
  ReloadOutlined,
  ClusterOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  LoadingOutlined
} from '@ant-design/icons';
import moment from 'moment';
import { api } from '../../api/api';
import { Project, EmbeddingStatus, Task } from '../../models/types';
import EmbeddingJobPanel from '../EmbeddingJobPanel/EmbeddingJobPanel';
import './styles.scss';

const { Title } = Typography;

const ProjectsList: React.FC = () => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [embeddingStatuses, setEmbeddingStatuses] = useState<Record<number, EmbeddingStatus>>({});
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [showEmbeddingPanel, setShowEmbeddingPanel] = useState<boolean>(false);

  const history = useHistory();

  const fetchProjects = async () => {
    setLoading(true);
    try {
      const data = await api.getProjects();
      setProjects(data);

      // Check embedding status for each project
      const statuses: Record<number, EmbeddingStatus> = {};
      for (const project of data) {
        try {
          const status = await api.checkEmbeddings(project.id);
          statuses[project.id] = status;
        } catch (error) {
          console.error(`Error checking embeddings for project ${project.id}:`, error);
          statuses[project.id] = { exists: false };
        }
      }
      setEmbeddingStatuses(statuses);
    } catch (error) {
      console.error('Error fetching projects:', error);
      message.error('Failed to fetch projects');
    } finally {
      setLoading(false);
    }
  };

  const fetchTasks = async (projectId: number) => {
    try {
      const data = await api.getTasks(projectId);
      setTasks(data);
    } catch (error) {
      console.error(`Error fetching tasks for project ${projectId}:`, error);
      message.error('Failed to fetch tasks');
    }
  };

  useEffect(() => {
    fetchProjects();
  }, []);

  const handleStartEmbedding = async (project: Project) => {
    setSelectedProject(project);
    await fetchTasks(project.id);
    setShowEmbeddingPanel(true);
  };

  const handleExploreProject = (projectId: number) => {
    history.push(`/project/${projectId}`);
  };

  const columns = [
    {
      title: 'ID',
      dataIndex: 'id',
      key: 'id',
      width: 80,
    },
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      render: (text: string) => <strong>{text}</strong>,
    },
    {
      title: 'Created',
      dataIndex: 'created_date',
      key: 'created_date',
      render: (date: string) => moment(date).format('YYYY-MM-DD HH:mm'),
    },
    {
      title: 'Tasks',
      dataIndex: 'task_count',
      key: 'task_count',
    },
    {
      title: 'Embeddings',
      key: 'embeddings',
      render: (_: any, record: Project) => {
        const status = embeddingStatuses[record.id];
        if (!status) {
          return <LoadingOutlined />;
        }

        return status.exists ? (
          <Tag color="success" icon={<CheckCircleOutlined />}>
            Available ({status.location})
          </Tag>
        ) : (
          <Tag color="error" icon={<CloseCircleOutlined />}>
            Not available
          </Tag>
        );
      },
    },
    {
      title: 'Actions',
      key: 'actions',
      render: (_: any, record: Project) => {
        const status = embeddingStatuses[record.id];

        return (
          <Space size="middle">
            <Button
              type="primary"
              icon={<ClusterOutlined />}
              onClick={() => handleExploreProject(record.id)}
              disabled={!status?.exists}
            >
              Explore
            </Button>
            <Button
              onClick={() => handleStartEmbedding(record)}
              icon={status?.exists ? <ReloadOutlined /> : undefined}
            >
              {status?.exists ? 'Recalculate' : 'Generate Embeddings'}
            </Button>
          </Space>
        );
      },
    },
  ];

  return (
    <div className="cvat-projects-list-page">
      <div className="cvat-projects-list-header">
        <Title level={2}>Projects</Title>
        <Button
          type="primary"
          icon={<ReloadOutlined />}
          onClick={fetchProjects}
          loading={loading}
        >
          Refresh
        </Button>
      </div>

      <div className="cvat-projects-list-content">
        <Table
          columns={columns}
          dataSource={projects}
          rowKey="id"
          loading={loading}
          pagination={{ pageSize: 10 }}
        />
      </div>

      {showEmbeddingPanel && selectedProject && (
        <EmbeddingJobPanel
          project={selectedProject}
          tasks={tasks}
          visible={showEmbeddingPanel}
          onClose={() => {
            setShowEmbeddingPanel(false);
            setSelectedProject(null);
            fetchProjects(); // Refresh the list after closing
          }}
        />
      )}
    </div>
  );
};

export default ProjectsList;
