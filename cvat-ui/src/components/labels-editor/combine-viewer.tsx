import React, { useEffect, useState } from 'react';
import Plot from 'react-plotly.js';
import { Spin, Alert, Button } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { getCore } from 'cvat-core-wrapper';

interface Props {
    labels: any[];
    projectInstance?: any;
}

function CombineViewer(props: Props): JSX.Element {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [sankeyData, setSankeyData] = useState<any>(null);
    const [isRecalculating, setIsRecalculating] = useState(false);

    const createSankeyData = (hierarchy: any) => {
        const labels: string[] = [];
        const sources: number[] = [];
        const targets: number[] = [];
        const values: number[] = [];
        const colors: string[] = [];
        const processedLabels: { [key: string]: number } = {};

        // Color mapping based on height from leaf
        // const getNodeColor = (height: number): string => {
        //     if (height === 0) return "#1890FF"; // Leaf nodes - CVAT primary blue
        //     const palette = [
        //         "#12D674",  // Emerald
        //         "#FFFC31",  // Yellow
        //         "#FC440F",  // Orange
        //         "#12D674",  // Emerald
        //     ];
        //     return palette[(height - 1) % palette.length];
        // };
        // const getNodeColor = (height: number): string => {
        //     if (height === 0) return "#0d0887"; // Leaf nodes - CVAT primary blue
        //     const palette = [
        //         "#7e03a8",  // Emerald
        //         "#cc4778",  // Yellow
        //         "#f89540",  // Orange
        //         "#f0f921",  // Emerald
        //     ];
        //     return palette[(height - 1) % palette.length];
        // };

        //viridis color palette
        // const getNodeColor = (height: number): string => {
        //     if (height === 0) return "#440154"; // Leaf nodes - CVAT primary blue
        //     const palette = [
        //         "#3b528b",  // Emerald
        //         "#21918c",  // Yellow
        //         "#5ec962",  // Orange
        //         "#fde725",  // Emerald
        //     ];
        //     return palette[(height - 1) % palette.length];
        // };

        //viridis color palette
        const getNodeColor = (height: number): string => {
            if (height === 0) return "#3b528b"; // Leaf nodes - CVAT primary blue
            const palette = [
                "#21918c",  // Emerald
                "#5ec962",  // Yellow
                "#fde725",  // Orange
                "#440154",  // Emerald
            ];
            return palette[(height - 1) % palette.length];
        };
        const processNode = (node: any, parentIdx: number, height: number) => {
            const nodeName = node.name;
            let currentIdx: number;

            if (nodeName in processedLabels) {
                currentIdx = processedLabels[nodeName];
            } else {
                currentIdx = labels.length;
                labels.push(nodeName);
                colors.push(getNodeColor(height));
                processedLabels[nodeName] = currentIdx;
            }

            if (parentIdx >= 0) {
                sources.push(currentIdx);
                targets.push(parentIdx);
                values.push(node.count || 1);
            }

            if (node.children) {
                node.children.forEach((child: any) => {
                    processNode(child, currentIdx, height + 1);
                });
            }
        };

        // Handle potential array of root categories
        const hierarchyData = Array.isArray(hierarchy) ? {
            name: "All Objects",
            type: "category",
            description: "Root category",
            children: hierarchy
        } : hierarchy;

        processNode(hierarchyData, -1, 0);

        return [{
            type: "sankey",
            orientation: "h",
            node: {
                pad: 15,
                thickness: 30,
                line: { color: "black", width: 0.2 },
                label: labels,
                color: colors
            },
            link: {
                source: sources,
                target: targets,
                value: values,
                color: 'rgba(150, 150, 150, 0.4)'
            }
        }];
    };

    const fetchHierarchy = async (forceRecalculate: boolean = false) => {
        if (!props.projectInstance) return;

        setLoading(true);
        if (forceRecalculate) setIsRecalculating(true);
        setError(null);

        try {
            const response = await fetch(
                `http://192.168.2.88:5000/api/labels/hierarchy/${props.projectInstance.id}${forceRecalculate ? '?force_recalculate=true' : ''}`,
                {
                    method: 'GET',
                    credentials: 'include',
                    headers: {
                        'Access-Control-Allow-Credentials': 'true',
                    },
                }
            );

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();

            if (data && data.hierarchy) {
                setSankeyData(createSankeyData(data.hierarchy));
            } else {
                console.error('Invalid response structure:', data);
                setError('Invalid hierarchy data received');
            }
        } catch (err: any) {
            console.error('Fetch error:', err);
            setError(err.message || 'Failed to fetch hierarchy data');
        } finally {
            setLoading(false);
            setIsRecalculating(false);
        }
    };

    useEffect(() => {
        fetchHierarchy();
    }, [props.projectInstance]);

    const layout = {
        title: {
            text: 'Label Hierarchy Analysis',
            font: { size: 24, color: '#111111' }
        },
        font: {
            family: 'Roboto, sans-serif',
            size: 12,
            color: '#111111'
        },
        paper_bgcolor: '#FFFFFF',
        plot_bgcolor: '#FAFAFA',
        width: 1000,
        height: 600,
        margin: {
            l: 25,
            r: 25,
            t: 40,
            b: 25
        }
    };

    return (
        <div className="cvat-combine-viewer">
            <div className="cvat-combine-viewer-toolbar">
                <Button
                    type="primary"
                    icon={<ReloadOutlined spin={isRecalculating} />}
                    loading={isRecalculating}
                    onClick={() => fetchHierarchy(true)}
                    disabled={loading || !props.projectInstance}
                >
                    Recalculate Hierarchy
                </Button>
            </div>

            {loading && !isRecalculating ? (
                <div className="cvat-combine-viewer-loading">
                    <Spin size="large" tip="Loading hierarchy data..." />
                </div>
            ) : isRecalculating ? (
                <div className="cvat-combine-viewer-loading">
                    <Spin size="large" tip="Recalculating hierarchy..." />
                </div>
            ) : error ? (
                <Alert
                    message="Error loading hierarchy"
                    description={error}
                    type="error"
                    showIcon
                />
            ) : !sankeyData ? (
                <Alert
                    message="No data available"
                    description="Please select a project to view its label hierarchy."
                    type="info"
                    showIcon
                />
            ) : (
                <Plot
                    data={sankeyData}
                    layout={layout}
                    config={{
                        displayModeBar: true,
                        displaylogo: false,
                        modeBarButtonsToRemove: ['lasso2d', 'select2d'],
                        toImageButtonOptions: {
                            format: 'svg',
                            filename: 'label_hierarchy',
                            height: 600,
                            width: 1000,
                            scale: 1
                        }
                    }}
                />
            )}
        </div>
    );
}

export default CombineViewer;