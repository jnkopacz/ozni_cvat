import React from 'react';
import Plot from 'react-plotly.js';

interface Props {
    labels: any[];
}

function CombineViewer(props: Props): JSX.Element {
    // Sample Sankey data
    const data = [{
        type: "sankey",
        orientation: "h",
        node: {
            pad: 15,
            thickness: 30,
            line: { color: "black", width: 0.5 },
            label: ["Root", "Category A", "Category B", "Label 1", "Label 2", "Label 3"],
            color: ["#00FFFF", "#FF00FF", "#00FF00", "#FFD700", "#FFD700", "#FFD700"]
        },
        link: {
            source: [0, 0, 1, 1, 2],
            target: [1, 2, 3, 4, 5],
            value: [1, 1, 1, 1, 1],
            color: 'rgba(150, 150, 150, 0.4)'
        }
    }];

    const layout = {
        title: {
            text: 'Label Hierarchy Analysis',
            font: { size: 26, color: '#00FFFF' }
        },
        font: {
            family: "Consolas, Monaco, 'Andale Mono', 'Ubuntu Mono', monospace",
            size: 11,
            color: "#E0E0E0"
        },
        paper_bgcolor: '#121212',
        plot_bgcolor: '#1E1E1E',
        width: 1000,
        height: 600
    };

    return (
        <div className="cvat-combine-viewer">
            <Plot
                data={data}
                layout={layout}
                config={{
                    displayModeBar: true,
                    displaylogo: false,
                    modeBarButtonsToRemove: ['lasso2d', 'select2d']
                }}
            />
        </div>
    );
}

export default CombineViewer;