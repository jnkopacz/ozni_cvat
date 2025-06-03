// src/components/ClusterExplorer/ClusterVisualization.tsx
import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Empty, Image, Button, Tooltip, Input, Modal, message } from 'antd';
import { SelectOutlined, DragOutlined, CloudUploadOutlined } from '@ant-design/icons';
import { useLabelingSession } from '../../contexts/LabelingSessionContext';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import './styles.scss';
import { api } from '../../api/api';

interface Point {
    id: string;
    x: number;
    y: number;
    z?: number;
    clusterId: number;
    selected: boolean;
    filename: string;
    description: string;
    imageUrl?: string;
}

interface Cluster {
  id: number;
  size: number;
  label: string | null;
  color: string;
}

interface VisualizationData {
  points: Point[];
  clusters: Cluster[];
  dimensions: number;
}

interface ClusterVisualizationProps {
    data: VisualizationData;
    zoom: number;
    onPointSelection: (points: string[]) => void;
    onClusterSelection: (clusterId: number | null) => void;
    selectedPoints: string[];
    selectedCluster: number | null;
    projectId: number;
    onSearch?: (value: string) => void;
    searchText?: string;
}

interface LassoPoint {
    x: number;
    y: number;
}

type SelectionMode = 'click' | 'lasso';

const ClusterVisualization: React.FC<ClusterVisualizationProps> = ({
    data,
    zoom,
    onPointSelection,
    onClusterSelection,
    selectedPoints,
    selectedCluster,
    projectId,
    onSearch,
    searchText
}) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const [scene] = useState(() => new THREE.Scene());
    const [camera] = useState(() => new THREE.PerspectiveCamera(75, 1, 0.1, 1000));
    const [renderer] = useState(() => new THREE.WebGLRenderer({ antialias: true }));
    const [controls, setControls] = useState<OrbitControls | null>(null);
    const [tooltip, setTooltip] = useState<{
        visible: boolean;
        x: number;
        y: number;
        point: Point | null;
    }>();
    const pointsRef = useRef<THREE.Points | null>(null);
    const cameraInitialized = useRef<boolean>(false);
    const mouseDownPosition = useRef<{ x: number; y: number } | null>(null);
    const isDragging = useRef<boolean>(false);
    const [selectionMode, setSelectionMode] = useState<SelectionMode>('click');
    const [isDrawingLasso, setIsDrawingLasso] = useState<boolean>(false);
    const [lassoPath, setLassoPath] = useState<LassoPoint[]>([]);
    const lassoCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const lassoContext = useRef<CanvasRenderingContext2D | null>(null);

    // Initialize scene
    useEffect(() => {
        if (!containerRef.current) return;

        // Setup
        const container = containerRef.current;
        const { width, height } = container.getBoundingClientRect();

        // Configure renderer
        renderer.setSize(width, height);
        renderer.setPixelRatio(window.devicePixelRatio);
        renderer.setClearColor(0xf0f0f0); // Light background to match theme
        container.appendChild(renderer.domElement);

        // Add grid with light theme colors
        const gridHelper = new THREE.GridHelper(10, 10, 0xc3c3c3, 0xd9d9d9);
        scene.add(gridHelper);

        // Configure camera
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        camera.position.z = 5;

        // Add ambient light
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
        scene.add(ambientLight);

        // Add controls
        const orbitControls = new OrbitControls(camera, renderer.domElement);
        orbitControls.enableDamping = true;
        orbitControls.dampingFactor = 0.05;
        setControls(orbitControls);

        // Create lasso canvas overlay
        const lassoCanvas = document.createElement('canvas');
        lassoCanvas.style.position = 'absolute';
        lassoCanvas.style.top = '0';
        lassoCanvas.style.left = '0';
        lassoCanvas.style.pointerEvents = 'none';
        lassoCanvas.style.zIndex = '10';
        lassoCanvas.width = width;
        lassoCanvas.height = height;
        container.appendChild(lassoCanvas);
        lassoCanvasRef.current = lassoCanvas;
        lassoContext.current = lassoCanvas.getContext('2d');

        // Animation loop
        const animate = () => {
            requestAnimationFrame(animate);
            orbitControls.update();
            renderer.render(scene, camera);
        };
        animate();

        // Cleanup
        return () => {
            if (container.contains(renderer.domElement)) {
                container.removeChild(renderer.domElement);
            }
            if (lassoCanvasRef.current && container.contains(lassoCanvasRef.current)) {
                container.removeChild(lassoCanvasRef.current);
            }
            orbitControls.dispose();
        };
    }, []);

    // Handle window resize
    useEffect(() => {
        const handleResize = () => {
            if (!containerRef.current) return;

            const { width, height } = containerRef.current.getBoundingClientRect();
            camera.aspect = width / height;
            camera.updateProjectionMatrix();
            renderer.setSize(width, height);
            
            // Resize lasso canvas
            if (lassoCanvasRef.current) {
                lassoCanvasRef.current.width = width;
                lassoCanvasRef.current.height = height;
            }
        };

        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    // Update points when data or selections change
    useEffect(() => {
        if (!data || !data.points.length) return;

        // Normalize coordinates to improve scaling
        const xs = data.points.map(p => p.x);
        const ys = data.points.map(p => p.y);
        const zs = data.points.map(p => p.z || 0);
        
        const xMin = Math.min(...xs), xMax = Math.max(...xs);
        const yMin = Math.min(...ys), yMax = Math.max(...ys);
        const zMin = Math.min(...zs), zMax = Math.max(...zs);
        
        const xRange = xMax - xMin || 1;
        const yRange = yMax - yMin || 1;
        const zRange = zMax - zMin || 1;
        
        // Scale to fit within a reasonable range (-5 to 5)
        const scale = 8;

        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(data.points.length * 3);
        const colors = new Float32Array(data.points.length * 3);
        const alphas = new Float32Array(data.points.length);

        data.points.forEach((point, i) => {
            positions[i * 3] = ((point.x - xMin) / xRange - 0.5) * scale;
            positions[i * 3 + 1] = ((point.y - yMin) / yRange - 0.5) * scale;
            positions[i * 3 + 2] = ((point.z || 0) - zMin) / zRange * scale - scale/2;

            // Determine if this point should be highlighted
            const isPointSelected = selectedPoints.includes(point.id);
            const isClusterSelected = selectedCluster !== null && point.clusterId === selectedCluster;
            const shouldHighlight = (selectedPoints.length > 0 && isPointSelected) || 
                                  (selectedCluster !== null && isClusterSelected) ||
                                  (selectedPoints.length === 0 && selectedCluster === null);

            if (shouldHighlight) {
                // Use original cluster color for highlighted points
                const cluster = data.clusters.find(c => c.id === point.clusterId);
                if (cluster) {
                    const color = new THREE.Color(cluster.color);
                    colors[i * 3] = color.r;
                    colors[i * 3 + 1] = color.g;
                    colors[i * 3 + 2] = color.b;
                }
            } else {
                // Use gray color for non-highlighted points (like Vue project)
                const grayColor = { r: 0.7, g: 0.7, b: 0.7 };
                colors[i * 3] = grayColor.r;
                colors[i * 3 + 1] = grayColor.g;
                colors[i * 3 + 2] = grayColor.b;
            }

            // Always use full alpha since we're using color changes instead
            alphas[i] = 1.0;
        });

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('alpha', new THREE.BufferAttribute(alphas, 1));

        // Create circle texture for clean points like the Vue project
        const createCircleTexture = () => {
            const canvas = document.createElement('canvas');
            canvas.width = 64;
            canvas.height = 64;
            
            const context = canvas.getContext('2d');
            if (!context) {
                throw new Error('Could not get 2D context from canvas');
            }
            
            context.beginPath();
            context.arc(32, 32, 30, 0, 2 * Math.PI);
            context.fillStyle = '#ffffff';
            context.fill();
            
            const texture = new THREE.Texture(canvas);
            texture.needsUpdate = true;
            return texture;
        };

        // Use PointsMaterial with circular texture like the Vue project
        const material = new THREE.PointsMaterial({
            size: 0.3, // Equivalent to pointSize * 0.1 from Vue project
            vertexColors: true,
            transparent: true,
            opacity: 0.6,
            sizeAttenuation: true,
            alphaTest: 0.5,
            map: createCircleTexture()
        });

        // Create points
        const points = new THREE.Points(geometry, material);

        // Remove old points and add new ones
        if (pointsRef.current) {
            const oldPosition = pointsRef.current.position.clone();
            const oldRotation = pointsRef.current.rotation.clone();
            const oldScale = pointsRef.current.scale.clone();

            scene.remove(pointsRef.current);
            points.position.copy(oldPosition);
            points.rotation.copy(oldRotation);
            points.scale.copy(oldScale);
        }

        scene.add(points);
        pointsRef.current = points;

        // Only set initial camera position if it hasn't been set yet
        if (!cameraInitialized.current) {
            const box = new THREE.Box3().setFromObject(points);
            const center = box.getCenter(new THREE.Vector3());
            const size = box.getSize(new THREE.Vector3());
            const maxDim = Math.max(size.x, size.y, size.z);
            
            // Position camera for better initial view (closer to the data)
            camera.position.set(
                center.x + maxDim * 0.6,
                center.y + maxDim * 0.4,
                center.z + maxDim * 0.8
            );
            camera.lookAt(center);

            if (controls) {
                controls.target.copy(center);
                controls.update();
            }

            cameraInitialized.current = true;
        }
    }, [data, selectedCluster, selectedPoints]); // Include both selectedCluster and selectedPoints

    // Lasso selection functions
    const isPointInPolygon = useCallback((point: { x: number; y: number }, polygon: LassoPoint[]): boolean => {
        if (polygon.length < 3) return false;
        
        let inside = false;
        for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
            if (((polygon[i].y > point.y) !== (polygon[j].y > point.y)) &&
                (point.x < (polygon[j].x - polygon[i].x) * (point.y - polygon[i].y) / (polygon[j].y - polygon[i].y) + polygon[i].x)) {
                inside = !inside;
            }
        }
        return inside;
    }, []);

    const getScreenPosition = useCallback((worldPosition: THREE.Vector3): { x: number; y: number } => {
        const vector = worldPosition.clone();
        vector.project(camera);
        
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return { x: 0, y: 0 };
        
        return {
            x: (vector.x * 0.5 + 0.5) * rect.width,
            y: (vector.y * -0.5 + 0.5) * rect.height
        };
    }, [camera]);

    const selectPointsInLasso = useCallback((lassoPoints: LassoPoint[]) => {
        if (!data || !pointsRef.current || lassoPoints.length < 3) return;

        const selectedPointIds: string[] = [];
        const positions = pointsRef.current.geometry.attributes.position;
        
        for (let i = 0; i < data.points.length; i++) {
            const worldPos = new THREE.Vector3(
                positions.getX(i),
                positions.getY(i),
                positions.getZ(i)
            );
            
            const screenPos = getScreenPosition(worldPos);
            
            if (isPointInPolygon(screenPos, lassoPoints)) {
                selectedPointIds.push(data.points[i].id);
            }
        }
        
        if (selectedPointIds.length > 0) {
            onPointSelection(selectedPointIds);
            // Don't set cluster selection for lasso - it might span multiple clusters
            onClusterSelection(null);
        }
    }, [data, isPointInPolygon, getScreenPosition, onPointSelection, onClusterSelection]);

    const drawLasso = useCallback((points: LassoPoint[]) => {
        const ctx = lassoContext.current;
        if (!ctx || points.length < 2) return;
        
        ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
        
        ctx.strokeStyle = '#1890ff';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        ctx.globalAlpha = 0.8;
        
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        
        for (let i = 1; i < points.length; i++) {
            ctx.lineTo(points[i].x, points[i].y);
        }
        
        // Close the path if we have enough points
        if (points.length > 2) {
            ctx.closePath();
            ctx.fillStyle = 'rgba(24, 144, 255, 0.1)';
            ctx.fill();
        }
        
        ctx.stroke();
    }, []);

    const clearLasso = useCallback(() => {
        const ctx = lassoContext.current;
        if (ctx) {
            ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
        }
        setLassoPath([]);
    }, []);

    // Handle mouse down to track drag start
    const handleMouseDown = (event: MouseEvent) => {
        if (!containerRef.current) return;
        
        const rect = containerRef.current.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        
        mouseDownPosition.current = { x: event.clientX, y: event.clientY };
        isDragging.current = false;
        
        if (selectionMode === 'lasso') {
            setIsDrawingLasso(true);
            setLassoPath([{ x, y }]);
            
            // Disable orbit controls during lasso drawing
            if (controls) {
                controls.enabled = false;
            }
        }
    };

    // Handle mouse move to detect dragging
    const handleMouseMoveForDrag = (event: MouseEvent) => {
        if (!containerRef.current) return;
        
        const rect = containerRef.current.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        
        if (mouseDownPosition.current) {
            const deltaX = Math.abs(event.clientX - mouseDownPosition.current.x);
            const deltaY = Math.abs(event.clientY - mouseDownPosition.current.y);
            const dragThreshold = 5; // pixels
            
            if (deltaX > dragThreshold || deltaY > dragThreshold) {
                isDragging.current = true;
            }
        }
        
        // Handle lasso drawing
        if (isDrawingLasso && selectionMode === 'lasso') {
            setLassoPath(prev => {
                const newPath = [...prev, { x, y }];
                drawLasso(newPath);
                return newPath;
            });
        }
    };

    // Handle mouse up to process clicks (only if not dragging)
    const handleMouseUp = (event: MouseEvent) => {
        if (!containerRef.current || !data || !pointsRef.current) {
            mouseDownPosition.current = null;
            return;
        }
        
        // Handle lasso completion
        if (isDrawingLasso && selectionMode === 'lasso') {
            setIsDrawingLasso(false);
            
            // Re-enable orbit controls
            if (controls) {
                controls.enabled = true;
            }
            
            // Select points within lasso
            if (lassoPath.length > 2) {
                selectPointsInLasso(lassoPath);
            }
            
            // Clear lasso after a short delay
            setTimeout(() => {
                clearLasso();
            }, 200);
            
            mouseDownPosition.current = null;
            return;
        }
        
        // Handle click selection (only if not dragging and in click mode)
        if (isDragging.current || selectionMode !== 'click') {
            mouseDownPosition.current = null;
            return;
        }

        const rect = containerRef.current.getBoundingClientRect();
        const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        const raycaster = new THREE.Raycaster();
        raycaster.params.Points!.threshold = 0.1;
        raycaster.setFromCamera(new THREE.Vector2(x, y), camera);

        const intersects = raycaster.intersectObject(pointsRef.current);

        if (intersects.length > 0) {
            const index = intersects[0].index;
            if (index !== undefined) {
                const clickedPoint = data.points[index];
                const clusterId = clickedPoint.clusterId;

                // Select all points in the same cluster
                const clusterPoints = data.points
                    .filter(point => point.clusterId === clusterId)
                    .map(point => point.id);

                onPointSelection(clusterPoints);
                onClusterSelection(clusterId);
            }
        } else {
            onPointSelection([]);
            onClusterSelection(null);
        }

        mouseDownPosition.current = null;
    };

    // Handle point hover
    const handleMouseMove = (event: MouseEvent) => {
        if (!containerRef.current || !data || !pointsRef.current || isDrawingLasso) return;

        const rect = containerRef.current.getBoundingClientRect();
        const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        const raycaster = new THREE.Raycaster();
        raycaster.params.Points!.threshold = 0.1;
        raycaster.setFromCamera(new THREE.Vector2(x, y), camera);

        const intersects = raycaster.intersectObject(pointsRef.current);

        if (intersects.length > 0) {
            const index = intersects[0].index;
            if (index !== undefined) {
                const point = data.points[index];
                setTooltip({
                    visible: true,
                    x: event.clientX,
                    y: event.clientY,
                    point
                });
            }
        } else {
            setTooltip(prev => prev?.visible ? { ...prev, visible: false } : prev);
        }
    };

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        // Combine mouse move handlers
        const combinedMouseMove = (event: MouseEvent) => {
            handleMouseMoveForDrag(event);
            handleMouseMove(event);
        };

        container.addEventListener('mousedown', handleMouseDown);
        container.addEventListener('mousemove', combinedMouseMove);
        container.addEventListener('mouseup', handleMouseUp);

        return () => {
            container.removeEventListener('mousedown', handleMouseDown);
            container.removeEventListener('mousemove', combinedMouseMove);
            container.removeEventListener('mouseup', handleMouseUp);
        };
    }, [data, selectionMode, isDrawingLasso, lassoPath, controls]);

    // Handle escape key to cancel lasso
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape' && isDrawingLasso) {
                setIsDrawingLasso(false);
                clearLasso();
                if (controls) {
                    controls.enabled = true;
                }
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [isDrawingLasso, controls, clearLasso]);

    const renderTooltip = (point: Point) => (
        <div className="cvat-cluster-point-tooltip">
            <div className="cvat-cluster-point-tooltip-image">
                {point.imageUrl && (
                    <Image
                        src={point.imageUrl}
                        alt="Chip preview"
                        width="100%"
                        height="100%"
                        preview={false}
                    />
                )}
            </div>
            <div className="cvat-cluster-point-tooltip-info">
                <div>Filename: {point.filename}</div>
                <div>Cluster: {point.clusterId}</div>
                <div>Description: {point.description}</div>
            </div>
        </div>
    );

    if (!data || data.points.length === 0) {
        return (
            <div className="cvat-cluster-visualization-container" ref={containerRef}>
                <Empty description="No visualization data available" />
            </div>
        );
    }

    return (
        <div className="cvat-cluster-visualization-wrapper">
            <div 
                className="cvat-cluster-visualization-container" 
                ref={containerRef}
                style={{ cursor: selectionMode === 'lasso' ? 'crosshair' : 'default' }}
            >
                {/* Search bar overlay */}
                <div className="cvat-cluster-visualization-search-overlay">
                    <Input.Search
                        placeholder="Search by filename or description"
                        allowClear
                        enterButton
                        style={{ width: 300 }}
                        onSearch={onSearch}
                        defaultValue={searchText}
                    />
                </div>
                
                {/* Selection mode buttons overlay */}
                <div className="cvat-cluster-visualization-controls-overlay">
                    <Tooltip title="Click to select clusters">
                        <Button
                            type={selectionMode === 'click' ? 'primary' : 'default'}
                            icon={<DragOutlined />}
                            onClick={() => {
                                setSelectionMode('click');
                                clearLasso();
                                if (controls) controls.enabled = true;
                            }}
                            size="small"
                        >
                            Click
                        </Button>
                    </Tooltip>
                    <Tooltip title="Draw lasso to select multiple points">
                        <Button
                            type={selectionMode === 'lasso' ? 'primary' : 'default'}
                            icon={<SelectOutlined />}
                            onClick={() => {
                                setSelectionMode('lasso');
                                clearLasso();
                            }}
                            size="small"
                        >
                            Lasso
                        </Button>
                    </Tooltip>
                </div>
                {tooltip?.visible && tooltip.point && (
                    <div
                        className="cvat-cluster-visualization-tooltip"
                        style={{
                            position: 'fixed',
                            left: tooltip.x + 10,
                            top: tooltip.y + 10,
                            backgroundColor: 'rgba(0, 0, 0, 0.8)',
                            color: 'white',
                            borderRadius: '4px',
                            padding: '8px',
                            boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
                            zIndex: 1000,
                            pointerEvents: 'none',
                        }}
                    >
                        {renderTooltip(tooltip.point)}
                    </div>
                )}
            </div>
        </div>
    );
};

export default ClusterVisualization;
