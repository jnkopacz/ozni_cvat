// src/components/EmbeddingJobPanel/EmbeddingJobPanel.tsx
import React, { useState, useEffect } from 'react';
import { 
  Modal, 
  Form, 
  Select, 
  InputNumber, 
  Button, 
  Progress, 
  Alert, 
  Checkbox, 
  Space, 
  Typography,
  Divider
} from 'antd';
import { CheckCircleOutlined, CloseCircleOutlined, LoadingOutlined } from '@ant-design/icons';
import { api } from '../../api/api';
import { Project, Task, EmbeddingJobRequest, EmbeddingJob } from '../../models/types';
import './styles.scss';

const { Option } = Select;
const { Title, Text } = Typography;

interface EmbeddingJobPanelProps {
  project: Project;
  tasks: Task[];
  visible: boolean;
  onClose: () => void;
}

const EmbeddingJobPanel: React.FC<EmbeddingJobPanelProps> = ({ 
  project, 
  tasks, 
  visible, 
  onClose 
}) => {
  const [form] = Form.useForm();
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<EmbeddingJob | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<boolean>(false);
  const [selectedTasks, setSelectedTasks] = useState<number[]>([]);
  const [selectAll, setSelectAll] = useState<boolean>(false);

  useEffect(() => {
    if (selectAll) {
      setSelectedTasks(tasks.map(task => task.id));
    } else if (selectedTasks.length === tasks.length) {
      setSelectAll(true);
    }
  }, [selectAll, tasks]);

  useEffect(() => {
    // Poll job status if we have a job ID
    if (jobId) {
      const interval = setInterval(async () => {
        try {
          const status = await api.getEmbeddingJobStatus(jobId);
          setJobStatus(status);
          
          if (status.status === 'completed') {
            clearInterval(interval);
            setSuccess(true);
          } else if (status.status === 'failed') {
            clearInterval(interval);
            setError(status.error || 'Job failed');
          }
        } catch (error) {
          console.error('Error polling job status:', error);
          clearInterval(interval);
          setError('Failed to get job status');
        }
      }, 2000);
      
      return () => clearInterval(interval);
    }
  }, [jobId]);

  const handleStartJob = async () => {
    try {
      setLoading(true);
      setError(null);
      setSuccess(false);
      
      const values = await form.validateFields();
      
      const jobRequest: EmbeddingJobRequest = {
        project_id: project.id,
        task_ids: selectedTasks,
        feature_type: values.feature_type,
        chip_limit: values.chip_limit,
        recalculate: values.recalculate
      };
      
      const response = await api.getEmbeddings(jobRequest);
      
      if (response.status === 'available') {
        setSuccess(true);
      } else if (response.status === 'started' && response.job_id) {
        setJobId(response.job_id);
      } else {
        setError('Unexpected response from server');
      }
    } catch (error) {
      console.error('Error starting embedding job:', error);
      setError('Failed to start embedding job');
    } finally {
      setLoading(false);
    }
  };

  const handleSelectAllTasks = (checked: boolean) => {
    setSelectAll(checked);
    if (checked) {
      setSelectedTasks(tasks.map(task => task.id));
    } else {
      setSelectedTasks([]);
    }
  };

  const handleTaskSelection = (taskId: number, checked: boolean) => {
    if (checked) {
      setSelectedTasks([...selectedTasks, taskId]);
    } else {
      setSelectedTasks(selectedTasks.filter(id => id !== taskId));
    }
  };

  const renderTaskSelection = () => (
    <div className="cvat-embedding-job-tasks">
      <div className="cvat-embedding-job-tasks-header">
        <Checkbox 
          checked={selectAll} 
          onChange={e => handleSelectAllTasks(e.target.checked)}
        >
          Select All Tasks
        </Checkbox>
        <Text type="secondary">
          {selectedTasks.length} of {tasks.length} tasks selected
        </Text>
      </div>
      <Divider style={{ margin: '8px 0' }} />
      <div className="cvat-embedding-job-tasks-list">
        {tasks.map(task => (
          <div key={task.id} className="cvat-embedding-job-task-item">
            <Checkbox 
              checked={selectedTasks.includes(task.id)}
              onChange={e => handleTaskSelection(task.id, e.target.checked)}
            >
              {task.name} (ID: {task.id})
            </Checkbox>
          </div>
        ))}
      </div>
    </div>
  );

  const renderJobStatus = () => {
    if (success) {
      return (
        <Alert
          message="Embeddings Available"
          description="The embeddings for this project are now available for exploration."
          type="success"
          showIcon
          icon={<CheckCircleOutlined />}
        />
      );
    }
    
    if (error) {
      return (
        <Alert
          message="Error"
          description={error}
          type="error"
          showIcon
          icon={<CloseCircleOutlined />}
        />
      );
    }
    
    if (jobStatus) {
      return (
        <div className="cvat-embedding-job-status">
          <Progress 
            percent={jobStatus.progress} 
            status={jobStatus.status === 'failed' ? 'exception' : undefined}
          />
          <Text>
            Status: {jobStatus.status}
            {jobStatus.status === 'processing' && <LoadingOutlined style={{ marginLeft: 8 }} />}
          </Text>
        </div>
      );
    }
    
    return null;
  };

  return (
    <Modal
      title={`Generate Embeddings for ${project.name}`}
      open={visible}
      onCancel={onClose}
      footer={[
        <Button key="back" onClick={onClose}>
          Close
        </Button>,
        <Button
          key="submit"
          type="primary"
          loading={loading}
          onClick={handleStartJob}
          disabled={selectedTasks.length === 0 || success}
        >
          Start Job
        </Button>,
      ]}
      width={700}
    >
      <div className="cvat-embedding-job-panel">
        {renderJobStatus()}
        
        <Form
          form={form}
          layout="vertical"
          initialValues={{
            feature_type: 'both',
            chip_limit: 50,
            recalculate: false
          }}
        >
          <Form.Item
            name="feature_type"
            label="Feature Type"
            tooltip="Choose which features to extract from the images"
          >
            <Select>
              <Option value="visual">Visual Features Only</Option>
              <Option value="semantic">Semantic Features Only</Option>
              <Option value="both">Both Visual and Semantic</Option>
            </Select>
          </Form.Item>
          
          <Form.Item
            name="chip_limit"
            label="Chip Limit"
            tooltip="Maximum number of chips to process per task"
          >
            <InputNumber min={1} max={1000} style={{ width: '100%' }} />
          </Form.Item>
          
          <Form.Item
            name="recalculate"
            valuePropName="checked"
          >
            <Checkbox>
              Recalculate (ignore existing embeddings)
            </Checkbox>
          </Form.Item>
        </Form>
        
        <Divider />
        
        <Title level={5}>Select Tasks</Title>
        {renderTaskSelection()}
      </div>
    </Modal>
  );
};

export default EmbeddingJobPanel;
