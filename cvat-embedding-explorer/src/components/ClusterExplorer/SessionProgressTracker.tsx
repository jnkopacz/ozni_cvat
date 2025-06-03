import React, { useState } from 'react';
import { Card, Progress, Typography, Row, Col, Tag, Statistic, Divider, Button, Modal, Input, message, Alert } from 'antd';
import { ClockCircleOutlined, CheckCircleOutlined, ExclamationCircleOutlined, CloudUploadOutlined } from '@ant-design/icons';
import { useLabelingSession } from '../../contexts/LabelingSessionContext';
import './styles.scss';

const { Title, Text } = Typography;

const SessionProgressTracker: React.FC = () => {
  const { getSessionStats, state, completeSession } = useLabelingSession();
  const stats = getSessionStats();
  const [showCompletionModal, setShowCompletionModal] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);

  const formatDuration = (milliseconds: number): string => {
    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  };

  const getEstimatedTimeRemaining = (): string => {
    if (stats.labeledChips === 0) return 'Calculating...';
    
    const avgTimePerChip = stats.sessionDuration / stats.labeledChips;
    const estimatedRemaining = avgTimePerChip * stats.remainingChips;
    
    return formatDuration(estimatedRemaining);
  };

  const getLabelBreakdown = () => {
    if (!state.session) return [];
    
    const labelCounts = new Map<string, number>();
    
    state.session.chipLabels.forEach((label) => {
      labelCounts.set(label, (labelCounts.get(label) || 0) + 1);
    });
    
    return Array.from(labelCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10); // Show top 10 labels
  };

  const labelBreakdown = getLabelBreakdown();

  const handleCompleteSession = async () => {
    try {
      setIsCompleting(true);
      await completeSession();
      message.success('Session completed successfully! Labels and annotations have been pushed to CVAT.');
      setShowCompletionModal(false);
    } catch (error) {
      console.error('Error completing session:', error);
      message.error(`Failed to complete session: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsCompleting(false);
    }
  };

  if (!state.session) {
    return null;
  }

  return (
    <Card className="cvat-session-progress-tracker" size="small">
      <div className="cvat-session-progress-header">
        <Title level={4} style={{ margin: 0 }}>
          Labeling Progress
        </Title>
        <Text type="secondary">
          Session Duration: {formatDuration(stats.sessionDuration)}
        </Text>
      </div>

      <div className="cvat-session-progress-main">
        <div className="cvat-session-progress-bar-container">
          <Progress
            percent={stats.progressPercentage}
            status={stats.progressPercentage === 100 ? 'success' : 'active'}
            strokeColor={{
              '0%': '#108ee9',
              '100%': '#87d068',
            }}
            showInfo={false}
          />
          <div className="cvat-session-progress-text">
            <Text strong>{stats.labeledChips}/{stats.totalChips}</Text>
            <Text type="secondary">({stats.progressPercentage}%)</Text>
          </div>
        </div>
      </div>

      <Row gutter={16} className="cvat-session-progress-stats">
        <Col span={6}>
          <Statistic
            title="Labeled"
            value={stats.labeledChips}
            prefix={<CheckCircleOutlined style={{ color: '#52c41a' }} />}
            valueStyle={{ color: '#52c41a' }}
          />
        </Col>
        <Col span={6}>
          <Statistic
            title="Remaining"
            value={stats.remainingChips}
            prefix={<ExclamationCircleOutlined style={{ color: '#faad14' }} />}
            valueStyle={{ color: '#faad14' }}
          />
        </Col>
        <Col span={6}>
          <Statistic
            title="Noise"
            value={stats.noiseChips}
            valueStyle={{ color: '#ff4d4f' }}
          />
        </Col>
        <Col span={6}>
          <Statistic
            title="ETA"
            value={getEstimatedTimeRemaining()}
            prefix={<ClockCircleOutlined />}
            valueStyle={{ fontSize: '14px' }}
          />
        </Col>
      </Row>

      {labelBreakdown.length > 0 && (
        <>
          <Divider style={{ margin: '12px 0' }} />
          <div className="cvat-session-progress-labels">
            <Text strong style={{ marginBottom: 8, display: 'block' }}>
              Applied Labels:
            </Text>
            <div className="cvat-session-progress-label-tags">
              {labelBreakdown.map(([label, count]) => (
                <Tag key={label} color="blue" style={{ marginBottom: 4 }}>
                  {label} ({count})
                </Tag>
              ))}
            </div>
          </div>
        </>
      )}

      {stats.progressPercentage === 100 && (
        <>
          <Divider style={{ margin: '12px 0' }} />
          <div className="cvat-session-progress-complete">
            <div style={{ marginRight: 12 }}>
              <CheckCircleOutlined style={{ color: '#52c41a', marginRight: 8 }} />
              <Text type="success" strong>
                Labeling session complete! All chips have been labeled.
              </Text>
            </div>
            
            {state.completionStatus.isCompleting ? (
              <div>
                <Progress 
                  percent={state.completionStatus.completionProgress} 
                  status="active"
                  strokeColor="#52c41a"
                  size="small"
                />
                <Text type="secondary" style={{ fontSize: '12px' }}>
                  Pushing results to CVAT...
                </Text>
              </div>
            ) : (
              <Button 
                type="primary" 
                icon={<CloudUploadOutlined />}
                onClick={() => setShowCompletionModal(true)}
                disabled={state.completionStatus.isCompleting}
              >
                Save New Labels
              </Button>
            )}
            
            {state.completionStatus.completionError && (
              <Alert 
                message="Completion Error" 
                description={state.completionStatus.completionError}
                type="error" 
                showIcon 
                style={{ marginTop: 8 }}
                closable
              />
            )}
          </div>
        </>
      )}
      
      <Modal
        title="Complete Labeling Session"
        open={showCompletionModal}
        onOk={handleCompleteSession}
        onCancel={() => setShowCompletionModal(false)}
        confirmLoading={isCompleting}
        okText="Save New Labels"
        cancelText="Cancel"
      >
        <div>
          <Text>
            This will update labels by:
          </Text>
          <ul style={{ marginTop: 8, marginBottom: 16 }}>
            <li>Creating new project labels in the CVAT project</li>
            <li>Updating annotation assignments to match your new labels</li>
          </ul>
        </div>
      </Modal>
    </Card>
  );
};

export default SessionProgressTracker;
