// src/components/ClusterExplorer/ChipViewer.tsx
import React, { useEffect, useState } from 'react';
import { Row, Col, Card, Spin, Empty, Typography, Tag, Checkbox, Button, Tooltip } from 'antd';
import { CloseOutlined, UndoOutlined } from '@ant-design/icons';
import { api } from '../../api/api';
import { useLabelingSession } from '../../contexts/LabelingSessionContext';
import './styles.scss';

const { Text } = Typography;

interface ChipViewerProps {
  projectId: number;
  chipIds: string[];
  clusterId: number;
  onChipMoveToNoise?: (chipId: string) => void;
  chipData?: { [key: string]: { filename: string; description: string } };
}

interface Chip {
  id: string;
  url: string;
  label: string | null;
  clusterId: number;
  selected: boolean;
  inNoise: boolean;
  filename: string;
  description: string;
}

const ChipViewer: React.FC<ChipViewerProps> = ({ 
  projectId, 
  chipIds, 
  clusterId, 
  onChipMoveToNoise,
  chipData
}) => {
  const [chips, setChips] = useState<Chip[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const { isChipInNoise, getChipLabel, moveChipToNoise } = useLabelingSession();

  useEffect(() => {
    const fetchChips = async () => {
      setLoading(true);
      try {
        // Create chip objects with URLs from our API
        const chipObjects = chipIds.map(id => {
          const data = chipData?.[id];
          return {
            id,
            url: api.getChipUrl(projectId, id),
            label: getChipLabel(id) || null,
            clusterId,
            selected: false,
            inNoise: isChipInNoise(id),
            filename: data?.filename || id,
            description: data?.description || 'No description available'
          };
        });

        setChips(chipObjects);
        setError(null);
      } catch (error) {
        console.error('Error fetching chips:', error);
        setError('Failed to load chip images');
      } finally {
        setLoading(false);
      }
    };

    fetchChips();
  }, [projectId, chipIds, clusterId, isChipInNoise, getChipLabel]);

  const handleChipSelection = (chipId: string, selected: boolean) => {
    setChips(prevChips =>
      prevChips.map(chip =>
        chip.id === chipId ? { ...chip, selected } : chip
      )
    );
  };

  const handleChipMoveToNoise = (chipId: string) => {
    moveChipToNoise(chipId);
    setChips(prevChips =>
      prevChips.map(chip =>
        chip.id === chipId ? { ...chip, inNoise: true } : chip
      )
    );
    onChipMoveToNoise?.(chipId);
  };

  const activeChips = chips.filter(chip => !chip.inNoise);
  const noiseChips = chips.filter(chip => chip.inNoise);

  if (loading) {
    return (
      <div className="cvat-chip-viewer-loading">
        <Spin size="large" />
        <Text>Loading chip images...</Text>
      </div>
    );
  }

  if (error) {
    return (
      <div className="cvat-chip-viewer-error">
        <Empty description={error} />
      </div>
    );
  }

  if (chips.length === 0) {
    return (
      <div className="cvat-chip-viewer-empty">
        <Empty description="No chips selected" />
      </div>
    );
  }

  return (
    <div className="cvat-chip-viewer">
      {/* Active Chips */}
      <div className="cvat-chip-viewer-section">
        <div className="cvat-chip-viewer-section-header">
          <Text strong>Cluster Chips ({activeChips.length})</Text>
          <Text type="secondary">Click X to move chips to noise cluster</Text>
        </div>
        <div className="cvat-chip-viewer-grid">
          <Row gutter={[16, 16]}>
            {activeChips.map(chip => (
              <Col key={chip.id} span={6}>
                <Card
                  className={`cvat-chip-card ${chip.selected ? 'cvat-chip-card-selected' : ''}`}
                  cover={
                    <div className="cvat-chip-card-image-container">
                      <img alt={`Chip ${chip.id}`} src={chip.url} />
                      <div className="cvat-chip-card-exclude-btn">
                        <Tooltip title="Move to noise cluster">
                          <Button
                            type="primary"
                            danger
                            size="small"
                            icon={<CloseOutlined />}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleChipMoveToNoise(chip.id);
                            }}
                          />
                        </Tooltip>
                      </div>
                    </div>
                  }
                  size="small"
                  hoverable
                  onClick={() => handleChipSelection(chip.id, !chip.selected)}
                >
                  <div className="cvat-chip-card-content">
                    <div className="cvat-chip-card-filename">
                      <Text strong>{chip.filename}</Text>
                    </div>
                    <div className="cvat-chip-card-description">
                      <Text type="secondary" title={chip.description}>
                        {chip.description}
                      </Text>
                    </div>
                  </div>
                </Card>
              </Col>
            ))}
          </Row>
        </div>
      </div>

      {/* Noise Chips */}
      {noiseChips.length > 0 && (
        <div className="cvat-chip-viewer-section cvat-chip-viewer-excluded">
          <div className="cvat-chip-viewer-section-header">
            <Text strong>Moved to Noise Cluster ({noiseChips.length})</Text>
            <Text type="secondary">These chips are now in the noise cluster (-1)</Text>
          </div>
          <div className="cvat-chip-viewer-grid">
            <Row gutter={[16, 16]}>
              {noiseChips.map(chip => (
                <Col key={chip.id} span={6}>
                  <Card
                    className="cvat-chip-card cvat-chip-card-excluded"
                    cover={
                      <div className="cvat-chip-card-image-container">
                        <img alt={`Chip ${chip.id}`} src={chip.url} />
                      </div>
                    }
                    size="small"
                  >
                    <div className="cvat-chip-card-content">
                      <div className="cvat-chip-card-filename">
                        <Text strong>{chip.filename}</Text>
                      </div>
                      <div className="cvat-chip-card-description">
                        <Text type="secondary" title={chip.description}>
                          {chip.description}
                        </Text>
                      </div>
                    </div>
                  </Card>
                </Col>
              ))}
            </Row>
          </div>
        </div>
      )}
    </div>
  );
};

export default ChipViewer;
