import React, { useEffect, useState } from 'react';
import Plot from 'react-plotly.js';
import { Spin, Alert } from 'antd';
import { getCore } from 'cvat-core-wrapper';

interface Props {
    labels: any[];
    projectInstance?: any;
}

function CombineViewer(props: Props): JSX.Element {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [sankeyData, setSankeyData] = useState<any>(null);

    const createSankeyData = (hierarchy: any) => {
        const labels: string[] = [];
        const sources: number[] = [];
        const targets: number[] = [];
        const values: number[] = [];
        const colors: string[] = [];
        const processedLabels: { [key: string]: number } = {};

        // Color mapping based on height from leaf
        const getNodeColor = (height: number): string => {
            if (height === 0) return "#1890FF"; // Leaf nodes - CVAT primary blue
            const palette = [
                "#12D674",  // Emerald
                "#FFFC31",  // Yellow
                "#FC440F",  // Orange
                "#12D674",  // Emerald
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
                line: { color: "black", width: 0.5 },
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

    useEffect(() => {
        const fetchHierarchy = async () => {
            if (!props.projectInstance) return;

            setLoading(true);
            setError(null);

            try {
                // Using fetch directly instead of core.server.request
                const response = await fetch(
                    `http://192.168.2.88:5000/api/labels/hierarchy/${props.projectInstance.id}`,
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
                    console.log('Received hierarchy data:', data.hierarchy); // Debug log
                    setSankeyData(createSankeyData(data.hierarchy));
                } else {
                    console.error('Invalid response structure:', data); // Debug log
                    setError('Invalid hierarchy data received');
                }
            } catch (err: any) {
                console.error('Fetch error:', err); // Debug log
                setError(err.message || 'Failed to fetch hierarchy data');
            } finally {
                setLoading(false);
            }
        };

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

    if (loading) {
        return (
            <div className="cvat-combine-viewer">
                <Spin size="large" tip="Loading hierarchy data..." />
            </div>
        );
    }

    if (error) {
        return (
            <div className="cvat-combine-viewer">
                <Alert
                    message="Error loading hierarchy"
                    description={error}
                    type="error"
                    showIcon
                />
            </div>
        );
    }

    if (!sankeyData) {
        return (
            <div className="cvat-combine-viewer">
                <Alert
                    message="No data available"
                    description="Please select a project to view its label hierarchy."
                    type="info"
                    showIcon
                />
            </div>
        );
    }

    return (
        <div className="cvat-combine-viewer">
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
        </div>
    );
}

export default CombineViewer;