// Copyright (C) 2020-2022 Intel Corporation
// Copyright (C) CVAT.ai Corporation
//
// SPDX-License-Identifier: MIT

import './styles.scss';
import React from 'react';
import Tabs from 'antd/lib/tabs';
import Text from 'antd/lib/typography/Text';
import modal from 'antd/lib/modal';
import { EditOutlined, BuildOutlined, ExclamationCircleOutlined, PieChartOutlined, ClusterOutlined } from '@ant-design/icons';
import { connect } from 'react-redux';
import { CombinedState } from 'reducers';
import { getCore } from 'cvat-core-wrapper';
import { collectStatisticsAsync } from 'actions/annotation-actions';

import { SerializedLabel, SerializedAttribute } from 'cvat-core-wrapper';
import RawViewer from './raw-viewer';
import ConstructorViewer from './constructor-viewer';
import ConstructorCreator from './constructor-creator';
import ConstructorUpdater from './constructor-updater';
import { idGenerator, LabelOptColor } from './common';
import ExplorerViewer from './explorer-viewer';
import CombineViewer from './combine-viewer';

enum ConstructorMode {
    SHOW = 'SHOW',
    CREATE = 'CREATE',
    UPDATE = 'UPDATE',
}

interface OwnProps {
    labels: any[];
    onSubmit: (labels: any[]) => void;
    sessionInstance?: NonNullable<CombinedState['annotation']['job']['instance']>;
    projectInstance?: any;
}

interface StateToProps {
    labels: any[];
    statistics: NonNullable<CombinedState['annotation']['statistics']['data']>;
    sessionInstance: NonNullable<CombinedState['annotation']['job']['instance']>;
}

interface DispatchToProps {
    collectStatistics: (session: StateToProps['sessionInstance']) => void;
}

type Props = OwnProps & StateToProps & DispatchToProps;

function mapStateToProps(state: CombinedState, ownProps: OwnProps): StateToProps {
    return {
        labels: ownProps.labels,
        statistics: state.annotation.statistics.data,
        sessionInstance: ownProps.sessionInstance
                   ?? state.annotation.job.instance!,
    };
}

const mapDispatchToProps: DispatchToProps = {
    collectStatistics: collectStatisticsAsync,
};

interface LabelsEditorState {
    constructorMode: ConstructorMode;
    creatorType: 'basic' | 'skeleton' | 'model';
    savedLabels: LabelOptColor[];
    unsavedLabels: LabelOptColor[];
    labelForUpdate: LabelOptColor | null;
    projectTasks: {
        taskId: number;
        numAnnotations: number;
        task: any;
    }[];
}

class LabelsEditorComponent extends React.PureComponent<
    Props,
    LabelsEditorState
> {
    public constructor(props: Props) {
        super(props);

        this.state = {
            savedLabels: [],
            unsavedLabels: [],
            constructorMode: ConstructorMode.SHOW,
            creatorType: 'basic',
            labelForUpdate: null,
            projectTasks: [],
        };
    }

    public componentDidMount(): void {
        console.log('LabelsEditor mounted with props:', this.props);
        // just need to perform the same code
        this.componentDidUpdate((null as any) as Props);
    }

    public componentDidUpdate(prevProps: Props): void {
        if (prevProps?.statistics !== this.props.statistics) {
            console.log('Statistics updated:', this.props.statistics);
        }

        function transformLabel(label: SerializedLabel): LabelOptColor {
            return {
                name: label.name,
                id: label.id || idGenerator(),
                color: label.color,
                type: label.type,
                sublabels: label.sublabels,
                svg: label.svg,
                attributes: label.attributes.map(
                    (attr: SerializedAttribute): SerializedAttribute => ({
                        id: attr.id || idGenerator(),
                        name: attr.name,
                        input_type: attr.input_type,
                        mutable: attr.mutable,
                        values: [...attr.values],
                        default_value: attr.default_value,
                    }),
                ),
            };
        }

        const { labels } = this.props;

        if (!prevProps || prevProps.labels !== labels) {
            const transformedLabels = labels.map(transformLabel);
            this.setState({
                savedLabels: transformedLabels.filter((label: LabelOptColor) => (label.id as number) >= 0),
                unsavedLabels: transformedLabels.filter((label: LabelOptColor) => (label.id as number) < 0),
            });
        }
    }

    private handleRawSubmit = (labels: LabelOptColor[]): void => {
        const unsavedLabels = [];
        const savedLabels = [];

        for (const label of labels) {
            if (label.id as number >= 0) {
                savedLabels.push(label);
            } else {
                unsavedLabels.push(label);
            }
        }

        this.setState({ unsavedLabels, savedLabels });
        this.handleSubmit(savedLabels, unsavedLabels);
    };

    private handleCreate = (label: LabelOptColor): void => {
        const { unsavedLabels, savedLabels } = this.state;
        const newUnsavedLabels = [
            ...unsavedLabels,
            {
                ...label,
                id: idGenerator(),
            },
        ];

        this.setState({ unsavedLabels: newUnsavedLabels });
        this.handleSubmit(savedLabels, newUnsavedLabels);
    };

    private handleUpdate = (label: LabelOptColor): void => {
        const { savedLabels, unsavedLabels } = this.state;

        const filteredSavedLabels = savedLabels.filter((_label: LabelOptColor) => _label.id !== label.id);
        const filteredUnsavedLabels = unsavedLabels.filter((_label: LabelOptColor) => _label.id !== label.id);
        if (label.id as number >= 0) {
            filteredSavedLabels.push(label);
            this.setState({
                savedLabels: filteredSavedLabels,
                constructorMode: ConstructorMode.SHOW,
            });
        } else {
            filteredUnsavedLabels.push(label);
            this.setState({
                unsavedLabels: filteredUnsavedLabels,
                constructorMode: ConstructorMode.SHOW,
            });
        }

        this.handleSubmit(filteredSavedLabels, filteredUnsavedLabels);
        this.setState({ constructorMode: ConstructorMode.SHOW });
    };

    private handlerCancel = (): void => {
        this.setState({ constructorMode: ConstructorMode.SHOW });
    };

    private handleDelete = (label: LabelOptColor): void => {
        const deleteLabel = (): void => {
            const { unsavedLabels, savedLabels } = this.state;

            const filteredUnsavedLabels = unsavedLabels
                .filter((_label: LabelOptColor): boolean => _label.id !== label.id);
            const filteredSavedLabels = savedLabels
                .filter((_label: LabelOptColor): boolean => _label.id !== label.id);

            this.setState({ savedLabels: filteredSavedLabels, unsavedLabels: filteredUnsavedLabels });
            this.handleSubmit(filteredSavedLabels, filteredUnsavedLabels);
        };

        if (typeof label.id !== 'undefined' && label.id >= 0) {
            modal.confirm({
                className: 'cvat-modal-delete-label',
                icon: <ExclamationCircleOutlined />,
                title: `Do you want to delete "${label.name}" label?`,
                content: 'This action cannot be undone. All annotations associated to the label will be deleted.',
                type: 'warning',
                okButtonProps: { type: 'primary', danger: true },
                onOk() {
                    deleteLabel();
                },
            });
        } else {
            deleteLabel();
        }
    };

    private handleSubmit(savedLabels: LabelOptColor[], unsavedLabels: LabelOptColor[]): void {
        function transformLabel(label: LabelOptColor): LabelOptColor {
            const transformed: any = {
                name: label.name,
                id: label.id as number < 0 ? undefined : label.id,
                color: label.color,
                type: label.type || 'any',
                attributes: label.attributes.map((attr: SerializedAttribute): SerializedAttribute => ({
                    name: attr.name,
                    id: attr.id as number < 0 ? undefined : attr.id,
                    input_type: attr.input_type.toLowerCase() as SerializedAttribute['input_type'],
                    default_value: attr.default_value,
                    mutable: attr.mutable,
                    values: [...attr.values],
                })),
            };

            if (label.type === 'skeleton') {
                transformed.svg = label.svg;
                transformed.sublabels = (label.sublabels || [])
                    .map((internalLabel: LabelOptColor) => transformLabel(internalLabel));
            }

            return transformed;
        }

        const { onSubmit } = this.props;
        const output = savedLabels.concat(unsavedLabels)
            .map((label: LabelOptColor): LabelOptColor => transformLabel(label));

        onSubmit(output);
    }

    private handleTabClick = (key: string): void => {
        // this.setState({ constructorMode: key as ConstructorMode });

        if (key === 'explorer') {
            const { sessionInstance, projectInstance, collectStatistics } = this.props;

            if (sessionInstance) {
                collectStatistics(sessionInstance);
            } else if (projectInstance) {
                const core = getCore();
                core.tasks.get({ projectId: projectInstance.id })
                    .then(async (tasks: any[]) => {
                        const tasksWithStats = await Promise.all(tasks.map(async (task) => {
                            try {
                                // Helper function to fetch all pages of data
                                const fetchAllPages = async (url: string, accumulatedResults: any[] = []): Promise<any[]> => {
                                    const response = await fetch(url);
                                    if (!response.ok) {
                                        throw new Error(`Failed to fetch ${url}: ${response.statusText}`);
                                    }
                                    const data = await response.json();
                                    const newResults = accumulatedResults.concat(data.results || []);
                                    if (data.next) {
                                        return fetchAllPages(data.next, newResults);
                                    }
                                    return newResults;
                                };

                                const [labelsResults, annotationsResponse, metaResponse] = await Promise.all([
                                    fetchAllPages(`http://192.168.2.88:8080/api/labels?scheme=json&task_id=${task.id}`),
                                    fetch(`http://192.168.2.88:8080/api/tasks/${task.id}/annotations?org=`),
                                    fetch(`http://192.168.2.88:8080/api/tasks/${task.id}/data/meta?org=`),
                                ]);

                                // The labels are now an array of results from all pages
                                const labels = { results: labelsResults };
                                const [annotations, meta] = await Promise.all([
                                    annotationsResponse.json(),
                                    metaResponse.json(),
                                ]);

                                console.log('labels ', task.id, labels);

                                // Group shapes by label_id
                                const shapesByLabel = annotations.shapes.reduce((acc: any, shape: any) => {
                                    if (!acc[shape.label_id]) {
                                        acc[shape.label_id] = {
                                            rectangle: { shape: 0, track: 0 },
                                            polygon: { shape: 0, track: 0 },
                                            polyline: { shape: 0, track: 0 },
                                            points: { shape: 0, track: 0 },
                                            ellipse: { shape: 0, track: 0 },
                                            cuboid: { shape: 0, track: 0 },
                                            skeleton: { shape: 0, track: 0 },
                                            mask: { shape: 0 },
                                            total: 0
                                        };
                                    }
                                    acc[shape.label_id][shape.type].shape++;
                                    acc[shape.label_id].total++;
                                    return acc;
                                }, {});

                                // Create statistics object for each label
                                const labelStats = labels.results.reduce((acc: any, label: any) => {
                                    acc[label.id] = {
                                        name: label.name,
                                        color: label.color,
                                        statistics: shapesByLabel[label.id] || {
                                            rectangle: { shape: 0, track: 0 },
                                            polygon: { shape: 0, track: 0 },
                                            polyline: { shape: 0, track: 0 },
                                            points: { shape: 0, track: 0 },
                                            ellipse: { shape: 0, track: 0 },
                                            cuboid: { shape: 0, track: 0 },
                                            skeleton: { shape: 0, track: 0 },
                                            mask: { shape: 0 },
                                            total: 0
                                        }
                                    };
                                    return acc;
                                }, {});

                                console.log('annotations', annotations)
                                console.log('annotations.shapes', annotations.shapes)
                                return {
                                    taskId: task.id,
                                    name: task.name,
                                    status: task.status,
                                    totalFrames: meta.size,
                                    labels: labels.results,
                                    annotations: annotations,
                                    statistics: {
                                        byLabel: labelStats,
                                        total: {
                                            rectangle: {
                                                shape: annotations.shapes.filter((s: any) => s.type === 'rectangle').length,
                                                track: 0
                                            },
                                            polygon: {
                                                shape: annotations.shapes.filter((s: any) => s.type === 'polygon').length,
                                                track: 0
                                            },
                                            polyline: {
                                                shape: annotations.shapes.filter((s: any) => s.type === 'polyline').length,
                                                track: 0
                                            },
                                            points: {
                                                shape: annotations.shapes.filter((s: any) => s.type === 'points').length,
                                                track: 0
                                            },
                                            ellipse: {
                                                shape: annotations.shapes.filter((s: any) => s.type === 'ellipse').length,
                                                track: 0
                                            },
                                            cuboid: {
                                                shape: annotations.shapes.filter((s: any) => s.type === 'cuboid').length,
                                                track: 0
                                            },
                                            skeleton: {
                                                shape: annotations.shapes.filter((s: any) => s.type === 'skeleton').length,
                                                track: 0
                                            },
                                            mask: {
                                                shape: annotations.shapes.filter((s: any) => s.type === 'mask').length,
                                            },
                                            total: annotations.shapes.length
                                        }
                                    }
                                };
                            } catch (error) {
                                console.error(`Error processing task ${task.id}:`, error);
                                return null;
                            }
                        }));
                        console.log('tasksWithStats', tasksWithStats)
                        const validTasks = tasksWithStats.filter((task) => task !== null);
                        console.log('validTasks', validTasks)
                        this.setState({
                            projectTasks: validTasks
                        });
                    })
                    .catch((error: Error) => {
                        console.error('Failed to fetch project tasks:', error);
                    });
            }
        }
    };

    public render(): JSX.Element {
        const {
            savedLabels,
            unsavedLabels,
            constructorMode,
            labelForUpdate,
            creatorType,
            projectTasks,
        } = this.state;

        const { statistics } = this.props;
        const savedAndUnsavedLabels = [...savedLabels, ...unsavedLabels];

        console.log('LabelsEditor render - Current statistics:', statistics);
        console.log('LabelsEditor render - Labels:', savedAndUnsavedLabels);

        let configuratorContent = null;
        if (constructorMode === ConstructorMode.SHOW) {
            configuratorContent = (
                <ConstructorViewer
                    key='viewer'
                    labels={savedAndUnsavedLabels}
                    onUpdate={(label: LabelOptColor): void => {
                        this.setState({
                            constructorMode: ConstructorMode.UPDATE,
                            labelForUpdate: label,
                        });
                    }}
                    onDelete={this.handleDelete}
                    onCreate={(_creatorType: 'basic' | 'skeleton' | 'model'): void => {
                        this.setState({
                            creatorType: _creatorType,
                            constructorMode: ConstructorMode.CREATE,
                        });
                    }}
                />
            );
        } else if (constructorMode === ConstructorMode.UPDATE && labelForUpdate !== null) {
            configuratorContent = (
                <ConstructorUpdater
                    key='updater'
                    label={labelForUpdate}
                    labelNames={this.props.labels.map((l) => l.name)}
                    onUpdate={this.handleUpdate}
                    onCancel={this.handlerCancel}
                />
            );
        } else if (constructorMode === ConstructorMode.CREATE) {
            configuratorContent = (
                <ConstructorCreator
                    key='creator'
                    creatorType={creatorType}
                    labelNames={this.props.labels.map((l) => l.name)}
                    onCreate={this.handleCreate}
                    onCancel={this.handlerCancel}
                />
            );
        }

        return (
            <Tabs
                defaultActiveKey='configurator'
                type='card'
                tabBarStyle={{ marginBottom: '0px' }}
                onTabClick={this.handleTabClick}
                items={[{
                    key: 'raw',
                    label: (
                        <span>
                            <EditOutlined />
                            <Text>Raw</Text>
                        </span>
                    ),
                    children: <RawViewer key='raw' labels={savedAndUnsavedLabels} onSubmit={this.handleRawSubmit} />,
                }, {
                    key: 'configurator',
                    label: (
                        <span>
                            <BuildOutlined />
                            <Text>Constructor</Text>
                        </span>
                    ),
                    children: configuratorContent,
                }, {
                    key: 'explorer',
                    label: (
                        <span>
                            <PieChartOutlined />
                            <Text>Explore</Text>
                        </span>
                    ),
                    children: (
                        <ExplorerViewer
                            key='explorer'
                            labels={savedAndUnsavedLabels}
                            statistics={statistics || undefined}
                            projectInstance={this.props.projectInstance}
                            projectTasks={projectTasks}
                        />
                    ),
                }, {
                    key: 'combine',
                    label: (
                        <span>
                            <ClusterOutlined />
                            <Text>COMBINE</Text>
                        </span>
                    ),
                    children: (
                        <CombineViewer
                            key='combine'
                            labels={savedAndUnsavedLabels}
                        />
                    ),
                }]}
            />
        );
    }
}

export default connect(mapStateToProps, mapDispatchToProps)(LabelsEditorComponent);
