import requests
import json
from pprint import pprint
import argparse
import plotly.graph_objects as go
from typing import List, Dict, Tuple, Any

class LabelHierarchyTester:
    def __init__(self, base_url="http://localhost:5000"):
        self.base_url = base_url
        self.project_id = None

    def create_sankey_data(self, hierarchy: Dict) -> Tuple[List[str], List[int], List[int], List[int], List[str]]:
        """Convert hierarchy to Sankey diagram data with height-based coloring."""
        labels: List[str] = []
        node_colors_list: List[str] = [] # Renamed to avoid conflict
        sources: List[int] = []
        targets: List[int] = []
        values: List[int] = []

        node_heights: Dict[str, int] = {} # To store calculated heights {node_name: height}

        def _calculate_and_store_heights(node_data: Dict[str, Any]) -> int:
            """Recursively calculates height of a node and stores it."""
            node_name = node_data['name']
            if node_name in node_heights: # Memoization for safety, though Sankey implies tree
                return node_heights[node_name]

            is_leaf_node = 'children' not in node_data or not node_data['children']
            if is_leaf_node:
                height = 0
            else:
                max_child_height = -1 # Ensure it gets updated if there's at least one child
                for child in node_data['children']:
                    max_child_height = max(max_child_height, _calculate_and_store_heights(child))
                height = 1 + max_child_height

            node_heights[node_name] = height
            return height

        # First pass: Calculate all node heights starting from the root
        _calculate_and_store_heights(hierarchy)

        def get_node_color_by_height(height_from_leaf: int) -> str:
            """Get color based on node's height from the furthest leaf."""
            if height_from_leaf == 0:
                return "#FFD700"  # Bright Gold for leaf nodes (Height 0)

            # Techy color palette for categories, indexed by (height_from_leaf - 1)
            # This means Height 1 categories (parents of leaves) use index 0 from this palette.
            tech_color_palette = {
                0: "#00FF00",  # Lime Green for Height 1 categories (Parents of leaves)
                1: "#FF00FF",  # Magenta for Height 2 categories
                2: "#00FFFF",  # Cyan for Height 3 categories
                3: "#FF8C00",  # DarkOrange for Height 4 categories
            }
            # Fallback colors for hierarchies with more levels
            default_colors_cycle = ["#ADFF2F", "#FFA07A", "#7B68EE", "#DB7093", "#1E90FF"]

            palette_index = height_from_leaf - 1 # Categories start at height 1

            if palette_index in tech_color_palette:
                return tech_color_palette[palette_index]
            else:
                # Cycle through default_colors_cycle for levels beyond the main palette
                effective_index = palette_index - len(tech_color_palette)
                if effective_index < 0: # Should not happen if height_from_leaf >= 1
                    return default_colors_cycle[0]
                return default_colors_cycle[effective_index % len(default_colors_cycle)]

        # To keep track of labels already added and their indices for Sankey processing
        processed_labels_indices: Dict[str, int] = {}

        def process_node_for_sankey(node_data: Dict[str, Any], parent_idx_in_labels_list: int):
            """
            Processes a node for Sankey diagram:
            - Adds label and color if new.
            - Creates link to parent.
            - Recursively processes children.
            """
            node_name = node_data['name']

            # Get or assign index for the current node in the `labels` list
            if node_name in processed_labels_indices:
                current_idx_in_labels_list = processed_labels_indices[node_name]
            else:
                current_idx_in_labels_list = len(labels)
                labels.append(node_name)
                processed_labels_indices[node_name] = current_idx_in_labels_list

                # Get pre-calculated height for coloring
                height = node_heights.get(node_name, 0) # Default to 0 (leaf) if somehow not found
                node_colors_list.append(get_node_color_by_height(height))

            # If this node has a parent, create a link from this node to its parent
            if parent_idx_in_labels_list >= 0:
                sources.append(current_idx_in_labels_list) # Current node is the source
                targets.append(parent_idx_in_labels_list)  # Parent node is the target

                # Calculate value for the link
                is_leaf_for_value_calc = 'children' not in node_data or not node_data['children']
                value = node_data.get('count', 1) # Default to 1 if count not present
                if not is_leaf_for_value_calc and 'count' not in node_data: # Is a category without its own count
                    # Sum counts of children if this category doesn't have an explicit count
                    value = sum(child.get('count', 1) for child in node_data.get('children', []))
                values.append(max(value, 1)) # Ensure value is at least 1 for visibility

            # Process children
            if 'children' in node_data:
                for child_data in node_data['children']:
                    # The current node becomes the parent for its children
                    process_node_for_sankey(child_data, current_idx_in_labels_list)

        # Second pass: Process the hierarchy to build Sankey lists (labels, sources, targets, values, colors)
        # The root node has no parent, so parent_idx_in_labels_list is -1.
        process_node_for_sankey(hierarchy, -1)

        return labels, sources, targets, values, node_colors_list

    def create_sankey_diagram(self, hierarchy_data: Dict, output_file: str = "label_hierarchy_sankey.html"):
        """Create and save an interactive Sankey diagram with a techy look"""
        # project_id for title should be set before calling this
        if self.project_id is None: # Fallback if project_id wasn't set correctly
            self.project_id = "N/A"

        labels, sources, targets, values, node_colors = self.create_sankey_data(hierarchy_data)

        if not labels: # If no data could be processed
            print("Warning: No data to create Sankey diagram. Labels list is empty.")
            return

        fig = go.Figure(data=[go.Sankey(
            node=dict(
                pad=25,
                thickness=20,
                line=dict(color="#777777", width=0.5),
                label=labels,
                color=node_colors,
                customdata=labels,
                hovertemplate='<b>%{customdata}</b><br />Value: %{value}<extra></extra>', # Changed "Count" to "Value" as it might be summed
            ),
            link=dict(
                source=sources,
                target=targets,
                value=values,
                color='rgba(150, 150, 150, 0.4)'
            ),
            arrangement='snap' # Tries to minimize link crossings
        )])

        fig.update_layout(
            title=dict(
                text=f"Label Hierarchy Analysis: Project {self.project_id}",
                font=dict(size=26, color='#00FFFF'),
                x=0.5,
                y=0.96
            ),
            font=dict(
                family="Consolas, Monaco, 'Andale Mono', 'Ubuntu Mono', monospace",
                size=11,
                color="#E0E0E0"
            ),
            paper_bgcolor='#121212',
            plot_bgcolor='#1E1E1E',
            height=900,
            width=1400,
            margin=dict(t=80, l=30, r=30, b=50)
        )

        fig.add_annotation(
            text="COMBINE HIERARCHY ENGINE",
            x=0.5,
            y=0.5,
            showarrow=False,
            font=dict(size=50, color="rgba(200, 200, 200, 0.06)"),
            textangle=-35,
            xref="paper",
            yref="paper",
            opacity=0.7
        )

        fig.write_html(
            output_file,
            config={
                'displayModeBar': True,
                'displaylogo': False,
                'modeBarButtonsToRemove': ['lasso2d', 'select2d'],
                'toImageButtonOptions': {
                    'format': 'png',
                    'filename': f'label_hierarchy_project_{self.project_id}',
                    'height': 900,
                    'width': 1400,
                    'scale': 2
                }
            }
        )
        print(f"\nEnhanced Sankey diagram with height-based coloring saved to {output_file}")

    def test_get_projects(self):
        """Test the projects endpoint and select a project"""
        print("\n=== Testing GET /api/projects ===")
        try:
            response = requests.get(f"{self.base_url}/api/projects", timeout=10)
            response.raise_for_status()
        except requests.exceptions.RequestException as e:
            print(f"Error fetching projects: {e}")
            self.project_id = "ErrorFetchingProjects" # Set a placeholder
            return None

        projects = response.json()
        print("\nAvailable Projects:")
        print("-" * 50)
        for project in projects:
            print(f"ID: {project['id']}")
            print(f"Name: {project['name']}")
            print(f"Task Count: {project['task_count']}")
            print(f"Created: {project['created_date']}")
            print("-" * 50)

        if projects:
            self.project_id = projects[0]['id']
            print(f"\nAutomatically selected Project ID: {self.project_id} for subsequent tests if not overridden.")
        else:
            print("No projects found.")
            self.project_id = "NoProjectsFound" # Set a placeholder
        return projects


    def test_get_label_hierarchy(self, project_id_to_test=None, force_recalculate=False):
        """Test the label hierarchy endpoint

        Args:
            project_id_to_test: Optional specific project ID to test
            force_recalculate: If True, force recalculation of hierarchy
        """
        current_project_id_for_api = project_id_to_test if project_id_to_test is not None else self.project_id

        if not current_project_id_for_api or current_project_id_for_api in ["ErrorFetchingProjects", "NoProjectsFound"]:
            print(f"No valid project ID available for API call (current value: {current_project_id_for_api}). Specify --project-id or ensure test_get_projects runs first and finds projects.")
            self.project_id = current_project_id_for_api if current_project_id_for_api else "Unknown"
            return None

        print(f"\n=== Testing GET /api/labels/hierarchy/{current_project_id_for_api} ===")
        url = f"{self.base_url}/api/labels/hierarchy/{current_project_id_for_api}"
        if force_recalculate:
            url += "?force_recalculate=true"
        try:
            response = requests.get(url, timeout=3000)
            response.raise_for_status()
        except requests.exceptions.RequestException as e:
            print(f"Error fetching label hierarchy for project {current_project_id_for_api}: {e}")
            print(f"Response text: {response.text if 'response' in locals() else 'No response object'}")
            self.project_id = current_project_id_for_api
            return None

        hierarchy_response = response.json()
        # output_file = f"label_hierarchy_project_{current_project_id_for_api}_raw.json"
        # with open(output_file, 'w') as f:
        #     json.dump(hierarchy_response, f, indent=2)
        # print(f"\nSaved raw hierarchy to {output_file}")

        # Use the project_id from the API response primarily for the diagram title
        # but fall back to current_project_id_for_api if not present in response
        self.project_id = hierarchy_response.get('project_id', current_project_id_for_api)

        print("\nHierarchy Summary (from API):")
        print(f"Project ID for diagram: {self.project_id}")
        print(f"Total Labels from API: {hierarchy_response.get('label_count', 'N/A')}")

        hierarchy_data_for_plot = hierarchy_response.get('hierarchy')

        if not hierarchy_data_for_plot:
            print("Error: 'hierarchy' key missing or empty in API response.")
            pprint(hierarchy_response)
            return None

        if isinstance(hierarchy_data_for_plot, list):
            if not hierarchy_data_for_plot:
                 print("Warning: Received an empty list for hierarchy data. Cannot create Sankey.")
                 return None
            print("Multiple root categories detected. Creating a synthetic 'All Objects' root.")
            hierarchy_data_for_plot = {
                "name": "All Objects", # Ensure this name is unique enough
                "type": "category",
                "description": "Synthetic root for multiple top-level categories.",
                "children": hierarchy_data_for_plot
            }
        elif not isinstance(hierarchy_data_for_plot, dict) or 'name' not in hierarchy_data_for_plot:
            print("Error: Hierarchy data is not in the expected dictionary format with a 'name'.")
            pprint(hierarchy_data_for_plot)
            return None

        print("\nFinal Hierarchy Structure (after potential modifications):")
        pprint(hierarchy_data_for_plot)

        self.create_sankey_diagram(hierarchy_data_for_plot)

        return hierarchy_response

# (main function remains the same as your previous version)
def main():
    parser = argparse.ArgumentParser(description="Test the Label Hierarchy Service and Generate Sankey Diagram")
    parser.add_argument("--url", default="http://localhost:5000", help="Base URL of the API (default: http://localhost:5000)")
    parser.add_argument("--project-id", type=str, help="Specific project ID to analyze (can be string like 'None' or numeric)")
    parser.add_argument("--force-recalculate", action="store_true", help="Force recalculation of the hierarchy instead of using cache")

    args = parser.parse_args()

    tester = LabelHierarchyTester(base_url=args.url)

    if args.project_id:
        try:
            pid_to_test = int(args.project_id)
        except ValueError:
            pid_to_test = args.project_id
        tester.test_get_label_hierarchy(pid_to_test, args.force_recalculate)
    else:
        tester.test_get_projects()
        if tester.project_id not in [None, "ErrorFetchingProjects", "NoProjectsFound"]:
            tester.test_get_label_hierarchy(force_recalculate=args.force_recalculate)
        else:
            print(f"No project ID specified and no valid project found via API (status: {tester.project_id}). Cannot generate hierarchy.")

if __name__ == "__main__":
    main()