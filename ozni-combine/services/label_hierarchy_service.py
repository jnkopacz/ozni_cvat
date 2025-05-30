from typing import List, Dict, Any
import json
from services.cvat_service import CVATService
from services.embedding_service import EmbeddingService
from ollama import Client
from config import OLLAMA_HOST, COMBINE_MODEL, LABEL_SUGGESTION_MODEL
import os
import datetime

class LabelHierarchyService:
    def __init__(self, cvat_service: CVATService, embedding_service: EmbeddingService):
        self.cvat_service = cvat_service
        self.embedding_service = embedding_service
        self._ollama_client = None

    @property
    def ollama_client(self):
        if self._ollama_client is None:
            self._ollama_client = Client(host=OLLAMA_HOST)
        return self._ollama_client

    def get_project_labels(self, project_id: int) -> Dict[str, int]:
        """Extract all unique labels from a project with their counts"""
        # Get label definitions from project
        label_info = self.cvat_service.get_project_labels(project_id)

        # Create mapping of ID to name
        label_map = {label['id']: label['name'] for label in label_info}

        # Initialize counts dictionary with all labels set to 0
        label_counts = {label['name']: 0 for label in label_info}

        # Get all tasks for the project
        tasks = self.cvat_service.get_tasks(project_id)

        # Count occurrences of each label
        for task in tasks:
            annotations = self.cvat_service.get_annotations(task['id'])
            for anno in annotations:
                label_name = label_map[anno['label']]
                label_counts[label_name] += 1

        return label_counts

    def analyze_label_hierarchy(self, labels: Dict[str, int]) -> Dict[str, Any]:
        """Use LLM to analyze labels and create a hierarchical structure"""
        # Construct prompt for the LLM with label counts

# You must use all input labels as base first level leaf nodes. Use the second level to merge duplicate or nearly identical labels.
# 4. The frequency of each label when determining importance

        label_info = [f"{label} " for label, count in labels.items()]
        prompt = f"""Given these labels from a computer vision dataset: {', '.join(label_info)}

Please analyze these labels and create a hierarchical categorization structure. Consider:
1. Common parent categories that group related labels
2. Natural subcategories within each group
3. Any implicit relationships between labels

The hierarchy should be a 4 layer hierarchy with the first level being the provided labels, the second level merging similar labels, the third level being the subcategories, and the fourth level being a logical summary level.

Output the hierarchy as a JSON structure with these properties:
- Each node should have a "name" and "children" array
- Leaf nodes (original labels) should have no children and include their count
- Include a "type" field for each node ("category" or "label")
- Add a "description" field explaining the grouping logic or label significance

Format the response as valid JSON only, no additional text."""
        print("Prompt", prompt)
        # Get LLM response using the embedding service's GPT-4V capabilities
        try:
            response = self.ollama_client.generate(
                model=COMBINE_MODEL,
                prompt=prompt,
                format="json"
            )
            # Parse the response as JSON
            hierarchy = json.loads(response.response)


            return hierarchy

        except Exception as e:
            print(f"Error analyzing label hierarchy: {e}")
            print(response)
            return {
                "error": str(e),
                "raw_labels": labels
            }

    def get_project_hierarchy(self, project_id: int, force_recalculate: bool = False) -> Dict[str, Any]:
        """Get complete label hierarchy for a project, with caching

        Args:
            project_id: The ID of the project to analyze
            force_recalculate: If True, ignore cache and recalculate hierarchy

        Returns:
            Dictionary containing project info and label hierarchy
        """
        # Define cache file path
        cache_file = f"cache/label_hierarchy_{project_id}.json"

        # Check cache if not forcing recalculation
        if not force_recalculate:
            try:
                with open(cache_file, 'r') as f:
                    return json.load(f)
            except (FileNotFoundError, json.JSONDecodeError):
                pass  # Cache miss or invalid cache, proceed with calculation

        # Get all labels from the project with counts
        label_counts = self.get_project_labels(project_id)
        print("Label counts", label_counts)

        # Analyze and create hierarchy
        hierarchy = self.analyze_label_hierarchy(label_counts)

        # Add validation and correction of flow counts
        def validate_flows(node, label_counts):
            if 'children' not in node or not node['children']:
                # For leaf nodes, get count from original label_counts
                print("Leaf node", node['name'], label_counts.get(node['name'], 1))
                node['count'] = label_counts.get(node['name'], 1)
                return node['count']

            # For non-leaf nodes, sum up children's counts
            total_count = sum(validate_flows(child, label_counts) for child in node['children'])
            node['count'] = total_count
            return total_count

        validate_flows(hierarchy, label_counts)

        #pretty print the hierarchy
        print(json.dumps(hierarchy, indent=2))

        result = {
            "project_id": project_id,
            "label_count": len(label_counts),
            "total_annotations": sum(label_counts.values()),
            "hierarchy": hierarchy,
            "cached_at": datetime.datetime.now().isoformat()
        }

        # Save to cache
        try:
            os.makedirs('cache', exist_ok=True)
            with open(cache_file, 'w') as f:
                json.dump(result, f, indent=2)
        except Exception as e:
            print(f"Warning: Failed to save cache file: {e}")

        return result

    def suggest_label_for_chips(self, project_id: int, chip_descriptions: List[str], existing_labels: List[str] = None) -> str:
        """Use LLM to suggest an appropriate label based on chip descriptions

        Args:
            project_id: The ID of the project to get context from
            chip_descriptions: List of text descriptions for the chips (max 10)
            existing_labels: List of existing labels from the UI session (optional)

        Returns:
            Suggested label as a string
        """
        # Limit to 10 descriptions for performance
        descriptions = chip_descriptions[:10]

        # Use provided existing labels or fall back to project labels
        if existing_labels is None:
            try:
                label_counts = self.get_project_labels(project_id)
                existing_labels = list(label_counts.keys())
            except Exception as e:
                print(f"Warning: Could not get existing labels for project {project_id}: {e}")
                existing_labels = []

        # Construct prompt for label suggestion
        descriptions_text = "\n".join([f"- {desc}" for desc in descriptions])
        existing_labels_text = ", ".join(existing_labels) if existing_labels else "No existing labels"

        prompt = f"""You are an expert in computer vision and machine learning annotation. Based on the following image descriptions, suggest a single, concise label that best represents what these images contain.

Image descriptions:
{descriptions_text}

Existing labels in this project: {existing_labels_text}

Guidelines:
1. Provide a single, clear label (1-3 words maximum). No parentheses. Spell out all acronyms.
2. Use consistent terminology with existing labels when possible
3. Focus on the most prominent or common feature across the descriptions
4. Use standard computer vision terminology
5. Be specific but not overly technical

Respond with only the suggested label, no additional text or explanation."""

        try:
            response = self.ollama_client.generate(
                model=LABEL_SUGGESTION_MODEL,
                prompt=prompt
            )

            # Clean up the response - remove any extra whitespace or quotes
            suggested_label = response.response.strip().strip('"').strip("'")

            # Ensure it's not empty and reasonable length
            if not suggested_label or len(suggested_label) > 50:
                return "Unknown"

            return suggested_label

        except Exception as e:
            print(f"Error generating label suggestion: {e}")
            return "Unknown"
