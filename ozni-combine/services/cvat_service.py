import cvat_sdk
from cvat_sdk import make_client
from PIL import Image
import io
import os
import sys
import time
from config import CVAT_HOST, CVAT_PORT, CVAT_USERNAME, CVAT_PASSWORD

class CVATService:
    def __init__(self):
        self.host = CVAT_HOST
        self.port = CVAT_PORT
        self.username = CVAT_USERNAME
        self.password = CVAT_PASSWORD

    def get_client(self):
        """Get a CVAT client connection"""
        return make_client(
            self.host,
            port=self.port,
            credentials=(self.username, self.password)
        )

    def get_projects(self):
        """Get all available projects"""
        with self.get_client() as client:
            projects = client.projects.list()
            return [
                {
                    'id': project.id,
                    'name': project.name,
                    'task_count': len(project.get_tasks()),
                    'created_date': project.created_date.isoformat() if hasattr(project, 'created_date') else None
                }
                for project in projects
            ]

    def get_tasks(self, project_id=None):
        """Get tasks, optionally filtered by project_id"""
        with self.get_client() as client:
            if project_id:
                # Convert project_id to int to ensure correct type
                project_id = int(project_id)
                project = client.projects.retrieve(project_id)
                tasks = project.get_tasks()
            else:
                tasks = client.tasks.list()

            return [
                {
                    'id': task.id,
                    'name': task.name,
                    'project_id': task.project_id,
                    'status': task.status,
                    'frame_count': len(task.get_frames_info())
                }
                for task in tasks
            ]

    def get_task_info(self, task_id):
        """Get detailed information about a task"""
        with self.get_client() as client:
            task_id = int(task_id)
            task = client.tasks.retrieve(task_id)
            frames_info = task.get_frames_info()

            return {
                'id': task.id,
                'name': task.name,
                'project_id': task.project_id,
                'status': task.status,
                'frame_count': len(frames_info),
                'size': {
                    'width': frames_info[0].width if frames_info else None,
                    'height': frames_info[0].height if frames_info else None
                }
            }

    def get_annotations(self, task_id):
        """Get annotations for a specific task"""
        with self.get_client() as client:
            task_id = int(task_id)
            task = client.tasks.retrieve(task_id)
            annotations = task.get_annotations()

            # Convert to a more JSON-friendly format
            shapes = []
            for shape in annotations.shapes:
                shapes.append({
                    'id': shape.id,
                    'type': str(shape.type).split('.')[-1].lower(),
                    'frame': shape.frame,
                    'label': shape.label_id,
                    'points': shape.points,
                    'attributes': {attr.name: attr.value for attr in shape.attributes}
                })

            return shapes

    def filter_annotations(self, annotations, filter_criteria):
        """Filter annotations based on criteria"""
        filtered = annotations

        # Filter by label
        if 'label_ids' in filter_criteria:
            filtered = [a for a in filtered if a['label'] in filter_criteria['label_ids']]

        # Filter by type
        if 'types' in filter_criteria:
            filtered = [a for a in filtered if a['type'] in filter_criteria['types']]

        # Filter by attributes
        if 'attributes' in filter_criteria:
            for attr_name, attr_value in filter_criteria['attributes'].items():
                filtered = [a for a in filtered if a['attributes'].get(attr_name) == attr_value]

        return filtered

    def get_frame(self, task_id, frame_id):
        """Get a specific frame as a PIL Image"""
        with self.get_client() as client:
            task_id = int(task_id)
            frame_id = int(frame_id)
            task = client.tasks.retrieve(task_id)
            frame_data = task.get_frame(frame_id)
            return Image.open(frame_data)