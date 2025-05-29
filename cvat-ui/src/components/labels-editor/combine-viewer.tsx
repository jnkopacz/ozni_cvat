import React, { useEffect, useState, useRef } from 'react';
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
    const [selectedHeight, setSelectedHeight] = useState<number | null>(null);
    const [cocoLabels, setCocoLabels] = useState<{[key: string]: number}>({});
    const [nodeHeights, setNodeHeights] = useState<number[]>([]);
    const heightsRef = useRef<number[]>([]);
    const updateInProgressRef = useRef(false);
    const [selectedColor, setSelectedColor] = useState<string | null>(null);
    const [originalHierarchy, setOriginalHierarchy] = useState<any>(null);

    const createSankeyData = (hierarchy: any) => {
        console.log("createSankeyData", hierarchy);
        console.log("selectedColor", selectedColor);
        const labels: string[] = [];
        const sources: number[] = [];
        const targets: number[] = [];
        const values: number[] = [];
        const colors: string[] = [];
        const heights: number[] = [];
        const processedLabels: { [key: string]: number } = {};

        const getNodeColor = (height: number, isSelected: boolean, selectedColor?: string): string => {

            const palette =  ["#1677FF","#9E16FF", "#77FF16", "#FF9E16", "#FF16EB"];
            let color = palette[(height) % palette.length];

            if (selectedColor) {
                if (color !== selectedColor) {
                    return color + "40"; // Add 25% opacity
                } else {
                    return color;
                }

            }
            return color;
        };

        const processNode = (node: any, parentIdx: number, height: number) => {
            const nodeName = node.name;
            let currentIdx: number;

            if (nodeName in processedLabels) {
                currentIdx = processedLabels[nodeName];
            } else {
                currentIdx = labels.length;
                labels.push(nodeName);
                colors.push(getNodeColor(height, false, selectedColor));
                heights.push(height);
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

            console.log("heights: ", height, selectedHeight);
            // if (height === selectedHeight) {
            //     //TODO append to coco labels
            // }
            if (height === selectedHeight || (height === 3 && selectedHeight === null)) {
                console.log("height matches selectedHeight", height, selectedHeight);
                // Update COCO labels for leaf nodes
                let label_name = nodeName;
                //to lower
                label_name = label_name.toLowerCase();
                //remove spaces
                label_name = label_name.replace(/\s+/g, '_');
                //remove s at the end to get rid of plurals
                label_name = label_name.replace(/s$/, '');
                //remove &
                label_name = label_name.replace(/&/g, 'and');

                //Remove the word dataset from the label name
                label_name = label_name.replace('_dataset', '');

                setCocoLabels(prev => ({
                    ...prev,
                    [label_name]: Object.keys(prev).length + 1
                }));
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

        // Store heights in both state and ref
        setNodeHeights(heights);
        heightsRef.current = heights;

        return [{
            type: "sankey",
            orientation: "h",
            node: {
                pad: 15,
                thickness: 30,
                line: { color: "black", width: 0.1 },
                label: labels,
                color: colors.map((color, idx) => getNodeColor(heights[idx], false, selectedColor)),
            },
            link: {
                source: sources,
                target: targets,
                value: values,
                color: sources.map(() => 'rgba(150, 150, 150, 0.4)')
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
                setOriginalHierarchy(data.hierarchy);
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

    useEffect(() => {
        console.log("Color change effect triggered:", {
            hasData: !!sankeyData,
            selectedColor,
            selectedHeight,
        });

        if (originalHierarchy && selectedColor !== undefined) {
            // Reset cocoLabels when selecting a new node
            setCocoLabels({});
            setSankeyData(createSankeyData(originalHierarchy));
        }
    }, [selectedColor]);

    const layout = {
        title: {
            text: 'COMbINE Hierarchy Analysis',
            font: { size: 24, color: '#111111' }
        },
        font: {
            family: 'Roboto, sans-serif',
            size: 12,
            color: '#111111'
        },
        paper_bgcolor: '#FFFFFF',
        plot_bgcolor: '#FAFAFA',
        width: 950,
        height: 600,
        margin: {
            l: 25,
            r: 25,
            t: 40,
            b: 25
        },
        clickmode: 'event',
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
                <>
                    <Plot
                        data={sankeyData}
                        layout={layout}
                        config={{
                            displayModeBar: true,
                            displaylogo: false,
                            modeBarButtonsToRemove: [
                                'lasso2d',
                                'select2d',
                                'toImage',
                                'resetScale2d',
                            ],
                            dragmode: false
                        }}
                        onClick={(data) => {
                            console.log("clicked!", data);
                            if (data.points && data.points[0]) {
                                const point = data.points[0];
                                console.log("point!", point);
                                if (point.pointNumber !== undefined) {
                                    const height = nodeHeights[point.pointNumber];
                                    // Get the color of the clicked node
                                    // let color = "#1677ff";
                                    // if (height > 0) {
                                    //     const palette = ["#21918c", "#5ec962", "#fde725", "#440154"];
                                    //     color = palette[(height - 1) % palette.length];
                                    // }
                                    const palette =  ["#1677FF","#9E16FF", "#77FF16", "#FF9E16", "#FF16EB"];
                                    let color = palette[(height) % palette.length];
                                    // Toggle the selected color
                                    setSelectedColor(selectedColor === color ? null : color);
                                }
                            }
                        }}
                        onUpdate={(figure) => {
                            console.log("Update event triggered", {
                                updateInProgress: updateInProgressRef.current,
                                figure: figure
                            });

                            if (updateInProgressRef.current || !figure.data?.[0]?.node) return;

                            try {
                                const clickedElement = document.querySelector('.sankey-node:hover');
                                console.log("Checking for clicked element:", {
                                    clickedElement,
                                    allNodes: document.querySelectorAll('.sankey-node').length
                                });

                                if (clickedElement) {
                                    const nodeRect = clickedElement.querySelector('rect');
                                    console.log("Child Node rect:", nodeRect);

                                    // Extract RGB values from style
                                    const style = nodeRect?.getAttribute('style');
                                    const rgbMatch = style?.match(/fill: rgb\((\d+),\s*(\d+),\s*(\d+)\)/);

                                    if (rgbMatch) {
                                        const [_, r, g, b] = rgbMatch;
                                        // Convert RGB to hex
                                        const hex = '#' + [r, g, b]
                                            .map(x => parseInt(x).toString(16).padStart(2, '0'))
                                            .join('').toUpperCase();


                                        updateInProgressRef.current = true;
                                        const palette =  ["#1677FF","#9E16FF", "#77FF16", "#FF9E16", "#FF16EB"];
                                        let color = hex;
                                        //height is the index of the color in the palette
                                        const height = palette.indexOf(color);

                                        console.log("Setting selected color:", {
                                            currentColor: selectedColor,
                                            newColor: color,
                                            height: height
                                        });

                                        setSelectedHeight(height);
                                        setSelectedColor(prevColor => prevColor === color ? null : color);

                                        setTimeout(() => {
                                            updateInProgressRef.current = false;
                                            console.log("Reset update flag");
                                        }, 100);
                                    }
                                }
                            } catch (error) {
                                console.error("Error in onUpdate handler:", error);
                                updateInProgressRef.current = false;
                            }
                        }}
                    />
                    {Object.keys(cocoLabels).length > 0 && (
                        <div style={{ marginTop: '20px', padding: '10px', background: '#f5f5f5', borderRadius: '4px' }}>
                            <h4>COMbINE Labels:</h4>
                            <pre>{JSON.stringify(cocoLabels, null, 2)}</pre>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}

export default CombineViewer;