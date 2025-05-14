import React from 'react';
import { Row, Col, Card, Statistic, Table, Alert } from 'antd/lib';
import { TagOutlined, ProjectOutlined, OrderedListOutlined } from '@ant-design/icons';
import { SerializedLabel } from 'cvat-core-wrapper';
import Text from 'antd/lib/typography/Text';
import { Column, ColumnConfig, Heatmap } from '@ant-design/plots';

interface ShapeCount {
    rectangle: number;
    polygon: number;
    polyline: number;
    points: number;
    ellipse: number;
    cuboid: number;
    skeleton: number;
    mask: number;
    tag: number;
}

interface ProjectTask {
    taskId: number;
    name: string;
    status: string;
    totalFrames: number;
    labels: SerializedLabel[];
    statistics: {
        byLabel: {
            [key: string]: {
                name: string;
                color: string;
                statistics: {
                    rectangle: { shape: number; track: number };
                    polygon: { shape: number; track: number };
                    polyline: { shape: number; track: number };
                    points: { shape: number; track: number };
                    ellipse: { shape: number; track: number };
                    cuboid: { shape: number; track: number };
                    skeleton: { shape: number; track: number };
                    mask: { shape: number };
                    total: number;
                };
            };
        };
        total: {
            rectangle: { shape: number; track: number };
            polygon: { shape: number; track: number };
            polyline: { shape: number; track: number };
            points: { shape: number; track: number };
            ellipse: { shape: number; track: number };
            cuboid: { shape: number; track: number };
            skeleton: { shape: number; track: number };
            mask: { shape: number };
            total: number;
        };
    };
}

interface DatasetAlert {
    type: 'warning' | 'error' | 'info';
    message: string;
    description: string;
}

interface Props {
    labels: SerializedLabel[];
    statistics?: {
        label: {
            [key: string]: {
                rectangle: { shape: number; track: number };
                polygon: { shape: number; track: number };
                polyline: { shape: number; track: number };
                points: { shape: number; track: number };
                ellipse: { shape: number; track: number };
                cuboid: { shape: number; track: number };
                skeleton: { shape: number; track: number };
                mask: { shape: number };
                tag: number;
                manually: number;
                interpolated: number;
                total: number;
            };
        };
        total: {
            rectangle: { shape: number; track: number };
            polygon: { shape: number; track: number };
            polyline: { shape: number; track: number };
            points: { shape: number; track: number };
            ellipse: { shape: number; track: number };
            cuboid: { shape: number; track: number };
            skeleton: { shape: number; track: number };
            mask: { shape: number };
            tag: number;
            manually: number;
            interpolated: number;
            total: number;
        };
    };
    projectInstance?: any;
    projectTasks?: ProjectTask[];
}

function analyzeClassImbalance(labelTotalCounts: Record<string, number>): DatasetAlert[] {
    const alerts: DatasetAlert[] = [];
    const counts = Object.values(labelTotalCounts);
    const total = counts.reduce((sum, count) => sum + count, 0);
    const mean = total / counts.length;
    const max_class_count = Math.max(...counts);
    const min_class_count = Math.min(...counts);

    Object.entries(labelTotalCounts).forEach(([label, count]) => {
        //If this class is 10x less than the max class count, it is an imbalance

        if (count < max_class_count / 20) {
            alerts.push({
                type: 'warning',
                message: 'Class Imbalance Detected',
                description: `Label "${label}" is underrepresented compared to the max class. Recommendation: Balance the classes during training.`
            });
        }
    });
    return alerts;
}

function analyzeClassCounts(labelTotalCounts: Record<string, number>): DatasetAlert[] {
    const alerts: DatasetAlert[] = [];
    const counts = Object.values(labelTotalCounts);
    const total = counts.reduce((sum, count) => sum + count, 0);
    const mean = total / counts.length;

    console.log('Label Total Counts:', labelTotalCounts);
    console.log('Total:', total);
    console.log('Mean:', mean);

    Object.entries(labelTotalCounts).forEach(([label, count]) => {
        console.log('Label:', label);
        console.log('Count:', count);
        if (count < 250) {
                alerts.push({
                    type: 'error',
                    message: 'Insufficient Data',
                    description: `Label "${label}" has too few samples (${count}). Recommendation: Increase the number of samples for this label.`,
                });
            }
        });
    return alerts;
}
function analyzeSpatialBias(heatmapData: Array<{ x: number; y: number; value: number }>): DatasetAlert[] {
    const alerts: DatasetAlert[] = [];
    const totalCells = heatmapData.length;
    const emptyCells = heatmapData.filter(cell => cell.value === 0).length;
    const emptyRatio = emptyCells / totalCells;
    const max_cell_value = Math.max(...heatmapData.map(cell => cell.value));
    const min_cell_value = Math.min(...heatmapData.map(cell => cell.value));

    if (emptyRatio > 0.7) {
        alerts.push({
            type: 'warning',
            message: 'Spatial Coverage Gap',
            description: `${Math.round(emptyRatio * 100)}% of image space has no annotations. See spectrogram below.`,
        });
    }

    //check if the min cell is 10x less than the max cell
    if (min_cell_value < max_cell_value / 10) {
        alerts.push({
            type: 'warning',
            message: 'Spatial Bias Detected',
            description: `Some portions of the annotation space are underrepresented. This may create a detection bias in a trained model's predictions. See spectrogram below.`,
        });
    }
    return alerts;
}

export default function ExplorerViewer({ labels, statistics, projectInstance, projectTasks }: Props): JSX.Element {
    console.log('ExplorerViewer - Project Instance:', projectInstance);
    const processAnnotationCoordinates = () => {
        const coordinates: number[][] = [];

        projectTasks?.forEach((task) => {
            console.log('Processing task:', task.taskId);
            if (task.annotations?.shapes) {
                task.annotations.shapes.forEach((shape) => {
                    if (shape.points && shape.points.length >= 4) {
                        const [x1, y1, x2, y2] = shape.points;
                        coordinates.push([x1, y1, x2, y2]);
                    }
                });
                console.log(`Added ${task.annotations.shapes.length} shapes from task ${task.taskId}`);
            }
        });

        console.log('Total annotations processed:', coordinates.length);
        return coordinates;
    };

    console.log("Processing annotation coordinates")
    const annotationCoordinates = processAnnotationCoordinates();

    const totalLabels = labels.length;
    const labelNames = labels.map(label => label.name).join(', ');

    // Calculate total annotations across all tasks
    const totalAnnotations = projectTasks?.reduce((sum, task) => {
        // Directly sum the number of shapes from each task's annotations
        return sum + (task.annotations?.shapes?.length || 0);
    }, 0) || 0;

    const totalTasks = projectTasks?.length || 0;

    // Calculate total counts per label
    const labelTotalCounts = labels.reduce((acc, label) => {
        acc[label.name] = 0;
        return acc;
    }, {} as Record<string, number>);

    // Sum up all annotations for each label

    //Task annotations are here task.annotations.shapes. We can get points from this object


    projectTasks?.forEach((task) => {
        console.log('Task:', task);
        Object.values(task.statistics.byLabel).forEach((labelStat) => {
            console.log('Label Stat:', labelStat);
            if (labelTotalCounts.hasOwnProperty(labelStat.name)) {
                labelTotalCounts[labelStat.name] += labelStat.statistics.total;
            }
        });
    });

    // Initialize shape counts for each label
    const labelShapeCounts = labels.reduce((acc, label) => {
        acc[label.name] = {
            rectangle: 0,
            polygon: 0,
            polyline: 0,
            points: 0,
            ellipse: 0,
            cuboid: 0,
            skeleton: 0,
            mask: 0,
            tag: 0,
        };
        return acc;
    }, {} as Record<string, ShapeCount>);

    // Update shape counts from all tasks
    projectTasks?.forEach((task) => {
        Object.values(task.statistics.byLabel).forEach((labelStat) => {
            if (labelShapeCounts[labelStat.name]) {
                const stats = labelStat.statistics;
                labelShapeCounts[labelStat.name].rectangle += (stats.rectangle?.shape || 0) + (stats.rectangle?.track || 0);
                labelShapeCounts[labelStat.name].polygon += (stats.polygon?.shape || 0) + (stats.polygon?.track || 0);
                labelShapeCounts[labelStat.name].polyline += (stats.polyline?.shape || 0) + (stats.polyline?.track || 0);
                labelShapeCounts[labelStat.name].points += (stats.points?.shape || 0) + (stats.points?.track || 0);
                labelShapeCounts[labelStat.name].ellipse += (stats.ellipse?.shape || 0) + (stats.ellipse?.track || 0);
                labelShapeCounts[labelStat.name].cuboid += (stats.cuboid?.shape || 0) + (stats.cuboid?.track || 0);
                labelShapeCounts[labelStat.name].skeleton += (stats.skeleton?.shape || 0) + (stats.skeleton?.track || 0);
                labelShapeCounts[labelStat.name].mask += stats.mask?.shape || 0;
            }
        });
    });

    // Prepare data for the histogram
    const chartData = Object.entries(labelTotalCounts)
        .map(([label, count]) => ({
            label,
            count,
        }));

    // Define chart configuration with proper typing
    const chartConfig: ColumnConfig = {
        data: chartData,
        xField: 'label',
        yField: 'count',
        height: 170,
        maxColumnWidth: 40,  // Limit maximum width of bars
        columnWidthRatio: 0.4,  // Control the width of bars relative to available space
        label: false,  // Remove the labels from the top of bars
        xAxis: {
            label: {
                autoRotate: true,
                autoHide: true,
                autoEllipsis: true,
            },
        },
        yAxis: {
            grid: {
                line: {
                    style: {
                        stroke: '#E5E5E5',
                    },
                },
            },
        },
        // padding: [40, 20, 20, 20],
        columnStyle: {
            radius: [4, 4, 0, 0],
        },
        color: '#597EF7',  // Set a specific color for the bars
    };

    // Table columns configuration
    const columns = [
        {
            title: <Text strong>Label</Text>,
            dataIndex: 'label',
            key: 'label',
            fixed: 'left' as const,
            width: 120,
        },
        {
            title: <Text strong>Rectangle</Text>,
            dataIndex: 'rectangle',
            key: 'rectangle',
            width: 100,
        },
        {
            title: <Text strong>Polygon</Text>,
            dataIndex: 'polygon',
            key: 'polygon',
            width: 100,
        },
        {
            title: <Text strong>Polyline</Text>,
            dataIndex: 'polyline',
            key: 'polyline',
            width: 100,
        },
        {
            title: <Text strong>Points</Text>,
            dataIndex: 'points',
            key: 'points',
            width: 100,
        },
        {
            title: <Text strong>Ellipse</Text>,
            dataIndex: 'ellipse',
            key: 'ellipse',
            width: 100,
        },
        {
            title: <Text strong>Cuboid</Text>,
            dataIndex: 'cuboid',
            key: 'cuboid',
            width: 100,
        },
        {
            title: <Text strong>Skeleton</Text>,
            dataIndex: 'skeleton',
            key: 'skeleton',
            width: 100,
        },
        {
            title: <Text strong>Mask</Text>,
            dataIndex: 'mask',
            key: 'mask',
            width: 100,
        },
        {
            title: <Text strong>Tag</Text>,
            dataIndex: 'tag',
            key: 'tag',
            width: 100,
        },
    ];

    // Prepare table data
    const tableData = Object.entries(labelShapeCounts).map(([label, counts]) => ({
        key: label,
        label,
        ...counts,
    }));

    // Task table columns
    const taskColumns = [
        {
            title: <Text strong>Task ID</Text>,
            dataIndex: 'taskId',
            key: 'taskId',
            width: 100,
        },
        {
            title: <Text strong>Name</Text>,
            dataIndex: 'name',
            key: 'name',
            width: 200,
        },
        {
            title: <Text strong>Status</Text>,
            dataIndex: 'status',
            key: 'status',
            width: 100,
        },
        {
            title: <Text strong>Total Frames</Text>,
            dataIndex: 'totalFrames',
            key: 'totalFrames',
            width: 120,
        },
        {
            title: <Text strong>Annotations</Text>,
            dataIndex: 'totalAnnotations',
            key: 'totalAnnotations',
            width: 120,
        }
    ];

    // Prepare task table data
    const taskData = projectTasks?.map((task) => ({
        key: task.taskId,
        taskId: task.taskId,
        name: task.name,
        status: task.status,
        totalFrames: task.totalFrames,
        totalAnnotations: task.statistics.total.total
    })) || [];

    const prepareHeatmapData = (coordinates: number[][]) => {
        // 1) grid dims
        const gridWidth  = 80;
        const gridHeight = 45;
        // 2) image dims
        const imgW = 1920;
        const imgH = 1080;

        // initialize zeroed grid
        const grid = Array(gridHeight)
          .fill(0)
          .map(() => Array(gridWidth).fill(0));

        // for each bbox, mark every cell it covers
        coordinates.forEach(([x1, y1, x2, y2]) => {

          // compute pixel‐to‐cell mapping
          const cellX1 = Math.floor((Math.min(x1, x2) / imgW) * gridWidth);
          const cellX2 = Math.floor((Math.max(x1, x2) / imgW) * gridWidth);
          const cellY1 = Math.floor((Math.min(y1, y2) / imgH) * gridHeight);
          const cellY2 = Math.floor((Math.max(y1, y2) / imgH) * gridHeight);



          // clamp & accumulate
          for (let cx = cellX1; cx <= cellX2; cx++) {
            if (cx < 0 || cx >= gridWidth) continue;
            for (let cy = cellY1; cy <= cellY2; cy++) {
              if (cy < 0 || cy >= gridHeight) continue;
              grid[cy][cx] += 1;
            }
          }
        });

        // flatten into plottable data (flip Y to match your origin)
        const heatmapData: Array<{ x: number; y: number; value: number }> = [];
        for (let y = 0; y < gridHeight; y++) {
          for (let x = 0; x < gridWidth; x++) {
            heatmapData.push({
              x,
              y: gridHeight - 1 - y,
              value: grid[y][x],
            });
          }
        }
        console.log(heatmapData)
        return heatmapData;
      };

    const heatmapData = prepareHeatmapData(annotationCoordinates);

    // Update heatmap configuration
    const heatmapConfig = {
        data: heatmapData,
        xField: 'x',
        yField: 'y',
        // colorField: 'value',
        colorField: 'value',

        color: ({ value }) => {
          if (value < 10)   return 'red';
          if (value < 100)  return 'orange';
          if (value < 500)  return 'yellow';
                            return 'green';
        },


        legend: {
            position: 'bottom',
        },
        // heatmapStyle: {
        //     stroke: 'transparent',  // Remove cell borders
        //     opacity: 1,            // Full opacity
        //     marginRight: '-1px',   // Negative margin to force overlap
        //     marginBottom: '-1px',  // Negative margin to force overlap
        // },
        shape: 'square',
        columnWidthRatio: 1,    // Increase column width ratio
        sizeRatio: 1,          // Increase size ratio further
        padding: [0, 0, 0, 0],    // Explicit padding removal
        meta: {
            x: {
                type: 'linear',
                min: 0,
                max: 79,   // gridWidth - 1
                tickCount: 10,
            },
            y: {
                type: 'linear',
                min: 0,
                max: 44,   // gridHeight - 1
                tickCount: 10,
            },
            value: {
                type: 'linear',
            },
        },
        heatmapStyle: {
            stroke: null,
            lineWidth: 0,
        },
        padding: 0,
        xAxis: false,
        yAxis: false,
        legend: false,
        tooltip: false,
        // meta: {
        //     x: { type: 'cat' },
        //     y: { type: 'cat' },
        // },
        // tooltip: {
        //     title: 'Density',
        //     formatter: (datum: any) => {
        //         return [
        //             { name: 'Relative Density', value: datum.value.toFixed(2) },
        //         ];
        //     },
        // },
        // interactions: [{ type: 'element-active' }],
        height: 400,
        width: 711,  // Maintains 16:9 ratio with height of 400 (400 * 16/9 ≈ 711)
        // autoFit: true,
        // appendPadding: [10, 10, 10, 10],
    };

    const datasetAlerts = [
        ...analyzeClassImbalance(labelTotalCounts),
        ...analyzeClassCounts(labelTotalCounts),
        ...analyzeSpatialBias(heatmapData),
    ];

    return (
        <div className='cvat-labels-explorer'>
            <Row gutter={[16, 16]}>
                <Col span={8}>
                    <Card>
                        <Statistic
                            title="Total Label Categories"
                            value={totalLabels}
                            prefix={<TagOutlined />}
                            suffix={<div style={{ fontSize: '14px', color: 'rgba(0, 0, 0, 0.45)' }}>{labelNames}</div>}
                        />
                    </Card>
                </Col>
                <Col span={8}>
                    <Card>
                        <Statistic
                            title="Total Labels"
                            value={totalAnnotations}
                            prefix={<OrderedListOutlined />}
                        />
                    </Card>
                </Col>
                <Col span={8}>
                    <Card>
                        <Statistic
                            title="Total Sub-datasets (Tasks)"
                            value={totalTasks}
                            prefix={<ProjectOutlined />}
                        />
                    </Card>
                </Col>
            </Row>

            <Row style={{ marginTop: '16px' }}>
                <Col span={24}>
                    <Card title="Dataset Quality Alerts">
                        {datasetAlerts.length === 0 ? (
                            <>
                                <Alert
                                    message="Class Balance Analysis"
                                    description={`All ${Object.keys(labelTotalCounts).length} classes are within normal distribution ranges.
                                        No class exceeds 3x the mean frequency (${Math.round(Object.values(labelTotalCounts).reduce((a, b) => a + b, 0) / Object.keys(labelTotalCounts).length)} annotations/class),
                                        and all classes have at least 1000 samples.`}
                                    type="success"
                                    showIcon
                                    style={{ marginBottom: '8px' }}
                                />
                                <Alert
                                    message="Spatial Distribution Analysis"
                                    description={`Good spatial coverage detected. ${Math.round((1 - heatmapData.filter(cell => cell.value === 0).length / heatmapData.length) * 100)}%
                                        of the image space contains annotations.`}
                                    type="success"
                                    showIcon
                                />
                            </>
                        ) : (
                            datasetAlerts.map((alert, index) => (
                                <Alert
                                    key={index}
                                    message={alert.message}
                                    description={alert.description}
                                    type={alert.type}
                                    showIcon
                                    style={{ marginBottom: index < datasetAlerts.length - 1 ? '8px' : 0 }}
                                />
                            ))
                        )}
                    </Card>
                </Col>
            </Row>

            <Row style={{ marginTop: '10px' }}>
                <Col span={24}>
                    <Card title="Project Sub-datasets (Tasks)">
                        <Table
                            columns={taskColumns}
                            dataSource={taskData}
                            pagination={false}
                            size="small"
                        />
                    </Card>
                </Col>
            </Row>

            <Row style={{ marginTop: '20px' }}>
                <Col span={24}>
                    <Card
                        title="Annotations Distribution by Label"
                        bodyStyle={{ padding: '12px' }}
                    >
                        <Column {...chartConfig} />
                    </Card>
                </Col>
            </Row>

            <Row style={{ marginTop: '20px' }}>
                <Col span={24}>
                    <Card
                        title="Annotation Location Heatmap"
                        bodyStyle={{ padding: '12px' }}
                    >
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                            <Text>Distribution of {annotationCoordinates.length} annotations</Text>
                            <Text type="secondary" style={{ marginBottom: '10px' }}>
                                Showing density across normalized image space
                            </Text>
                            <Heatmap {...heatmapConfig} />
                        </div>
                    </Card>
                </Col>
            </Row>

            <Row style={{ marginTop: '10px' }}>
                <Col span={24}>
                    <Card title="Class and Shape Type Statistics">
                        <Table
                            columns={columns}
                            dataSource={tableData}
                            scroll={{ x: 'max-content' }}
                            pagination={false}
                            size="small"
                        />
                    </Card>
                </Col>
            </Row>
        </div>
    );
}
