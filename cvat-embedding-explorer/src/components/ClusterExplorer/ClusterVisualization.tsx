// src/components/ClusterExplorer/ClusterVisualization.tsx
import React, { useRef, useEffect, useState } from 'react';
import { Empty, Image } from 'antd';
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
}

const ClusterVisualization: React.FC<ClusterVisualizationProps> = ({
    data,
    zoom,
    onPointSelection,
    onClusterSelection,
    selectedPoints,
    selectedCluster,
    projectId
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

    // Initialize scene
    useEffect(() => {
        if (!containerRef.current) return;

        // Setup
        const container = containerRef.current;
        const { width, height } = container.getBoundingClientRect();

        // Configure renderer
        renderer.setSize(width, height);
        renderer.setPixelRatio(window.devicePixelRatio);
        renderer.setClearColor(0x1a1a1a); // Dark gray background
        container.appendChild(renderer.domElement);

        // Add grid
        const gridHelper = new THREE.GridHelper(20, 20, 0x444444, 0x333333);
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

        // Animation loop
        const animate = () => {
            requestAnimationFrame(animate);
            orbitControls.update();
            renderer.render(scene, camera);
        };
        animate();

        // Cleanup
        return () => {
            container.removeChild(renderer.domElement);
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
        };

        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    // Update points when data or selections change
    useEffect(() => {
        if (!data || !data.points.length) return;

        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(data.points.length * 3);
        const colors = new Float32Array(data.points.length * 3);
        const alphas = new Float32Array(data.points.length);

        data.points.forEach((point, i) => {
            positions[i * 3] = point.x;
            positions[i * 3 + 1] = point.y;
            positions[i * 3 + 2] = point.z || 0;

            const cluster = data.clusters.find(c => c.id === point.clusterId);
            if (cluster) {
                const color = new THREE.Color(cluster.color);
                colors[i * 3] = color.r;
                colors[i * 3 + 1] = color.g;
                colors[i * 3 + 2] = color.b;
            }

            // Set alpha based on cluster selection or individual point selection
            const isPointSelected = selectedPoints.includes(point.id);
            const isClusterSelected = selectedCluster !== null && point.clusterId === selectedCluster;
            
            if (selectedPoints.length > 0) {
                // In search/point selection mode, highlight selected points
                alphas[i] = isPointSelected ? 1.0 : 0.2;
            } else if (selectedCluster !== null) {
                // In cluster selection mode, highlight selected cluster
                alphas[i] = isClusterSelected ? 1.0 : 0.2;
            } else {
                // No selection, show all points normally
                alphas[i] = 1.0;
            }
        });

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('alpha', new THREE.BufferAttribute(alphas, 1));

        // Update shader material to handle alpha
        const material = new THREE.ShaderMaterial({
            vertexShader: `
                attribute vec3 color;
                attribute float alpha;
                varying vec3 vColor;
                varying float vAlpha;
                void main() {
                    vColor = color;
                    vAlpha = alpha;
                    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                    gl_Position = projectionMatrix * mvPosition;
                    gl_PointSize = 1.0 * (100.0 / -mvPosition.z);
                }
            `,
            fragmentShader: `
                varying vec3 vColor;
                varying float vAlpha;
                void main() {
                    vec2 center = gl_PointCoord - vec2(0.5);
                    float dist = length(center);
                    if (dist > 0.5) discard;
                    float alpha = vAlpha * (1.0 - smoothstep(0.45, 0.5, dist));
                    gl_FragColor = vec4(vColor, alpha);
                }
            `,
            transparent: true,
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
            camera.position.copy(center);
            camera.position.z += maxDim * 2;
            camera.lookAt(center);

            if (controls) {
                controls.target.copy(center);
                controls.update();
            }

            cameraInitialized.current = true;
        }
    }, [data, selectedCluster, selectedPoints]); // Include both selectedCluster and selectedPoints

    // Update click handler to select all points in the same cluster
    const handleClick = (event: MouseEvent) => {
        if (!containerRef.current || !data || !pointsRef.current) return;

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
    };

    // Handle point hover
    const handleMouseMove = (event: MouseEvent) => {
        if (!containerRef.current || !data || !pointsRef.current) return;

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

        container.addEventListener('click', handleClick);
        container.addEventListener('mousemove', handleMouseMove);

        return () => {
            container.removeEventListener('click', handleClick);
            container.removeEventListener('mousemove', handleMouseMove);
        };
    }, [data]);

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
        <div className="cvat-cluster-visualization-container" ref={containerRef}>
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
    );
};

export default ClusterVisualization;
