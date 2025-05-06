// src/components/ClusterExplorer/ChipViewer.tsx
import React, { useEffect, useState } from 'react';
import { Row, Col, Card, Spin, Empty, Typography, Tag, Checkbox } from 'antd';
import { api } from '../../api/api';
import './styles.scss';

const { Text } = Typography;

interface ChipViewerProps {
  projectId: number;
  chipIds: string[];
}

interface Chip {
  id: string;
  url: string;
  label: string | null;
  clusterId: number;
  selected: boolean;
}

const ChipViewer: React.FC<ChipViewerProps> = ({ projectId, chipIds }) => {
  const [chips, setChips] = useState<Chip[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchChips = async () => {
      setLoading(true);
      try {
        // Create chip objects with URLs from our API
        const chipObjects = chipIds.map(id => ({
          id,
          url: api.getChipUrl(projectId, id),
          label: null, // We don't have labels from the API yet
          clusterId: -1, // We don't have this information here
          selected: false
        }));

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
  }, [projectId, chipIds]);

  const handleChipSelection = (chipId: string, selected: boolean) => {
    setChips(prevChips =>
      prevChips.map(chip =>
        chip.id === chipId ? { ...chip, selected } : chip
      )
    );
  };

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
      <div className="cvat-chip-viewer-grid">
        <Row gutter={[16, 16]}>
          {chips.map(chip => (
            <Col key={chip.id} span={6}>
              <Card
                className={`cvat-chip-card ${chip.selected ? 'cvat-chip-card-selected' : ''}`}
                cover={<img alt={`Chip ${chip.id}`} src={chip.url} />}
                size="small"
                hoverable
                onClick={() => handleChipSelection(chip.id, !chip.selected)}
              >
                <div className="cvat-chip-card-content">
                  <Checkbox
                    checked={chip.selected}
                    onChange={e => handleChipSelection(chip.id, e.target.checked)}
                    onClick={e => e.stopPropagation()}
                  />
                  {chip.label ? (
                    <Tag color="blue">{chip.label}</Tag>
                  ) : (
                    <Tag color="gray">Unlabeled</Tag>
                  )}
                </div>
              </Card>
            </Col>
          ))}
        </Row>
      </div>
    </div>
  );
};

export default ChipViewer;