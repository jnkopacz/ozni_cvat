import cvat_sdk
from cvat_sdk import make_client
from PIL import Image
import io
import os
import sys
import time
from config import CVAT_HOST, CVAT_PORT, CVAT_USERNAME, CVAT_PASSWORD
from cvat_sdk.api_client import models
from cvat_sdk.api_client.api_client import ApiClient
from cvat_sdk.models import PatchedLabeledDataRequest  # or PatchedLabeledTrackRequest, PatchedLabeledImageRequest depending on type
from cvat_sdk.models import PatchedLabeledDataRequest, LabeledShapeRequest

import requests
from http import HTTPStatus


class CVATService:
    def __init__(self):
        self.host = CVAT_HOST
        self.port = CVAT_PORT
        self.username = CVAT_USERNAME
        self.password = CVAT_PASSWORD
        self.API_URL = self.host + ":" + self.port + "/api/"

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
        
    def get_api_url(self, endpoint, **kwargs):
        return self.API_URL + endpoint + "?" + self._to_query_params(**kwargs)
    
    def _to_query_params(self, **kwargs):
        return "&".join([f"{k}={v}" for k, v in kwargs.items()])
    
    def patch_method(self, endpoint, data, **kwargs):
        print(f"PATCH {self.get_api_url(endpoint, **kwargs)} with data: {data}, and auth credentials: {self.username}:{self.password}")
        return requests.patch(self.get_api_url(endpoint, **kwargs), json=data, auth=(self.username, self.password))
    


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
                    # 'attributes': {attr.name: attr.value for attr in shape.attributes}
                })
            print(shapes)
            print("from cvat_service.py get_annotations")
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

    def get_project_labels(self, project_id):
        """Get all labels for a project"""
        with self.get_client() as client:
            project_id = int(project_id)
            project = client.projects.retrieve(project_id)
            labels = project.get_labels()
            return [
                {
                    'id': label.id,
                    'name': label.name
                }
                for label in labels
            ]

    def create_project_label(self, project_id, label_data):
        """Create a new label in a CVAT project"""
        print(f"Creating label in project {project_id} with data: {label_data}")

        #Check if it already exists
        existing_labels = self.get_project_labels(project_id)
        print("Existing labels in project:", existing_labels)
        for existing_label in existing_labels:
            if 'name' not in existing_label or 'id' not in existing_label:
                print("Skipping invalid label:", existing_label)
                continue
            if existing_label['name'] == label_data['name']:
                print("Existing label found:", existing_label)
                return {
                    'id': existing_label['id'],
                    'name': existing_label['name'],
                    'exists': True
                }
        print("No existing label found, proceeding to create a new one.")
        # Create new label
        response = self.patch_method(f'projects/{project_id}', {"labels": [label_data]})
        if response.status_code not in [200, 201, 202]:
            raise Exception(f"Failed to create label: {response.text}")
        print("Label created successfully, response:", response.json())
        #get label from get_project_labels
        labels = self.get_project_labels(project_id)
        print("Checking new list of labels in project", labels)
        for label in labels:
            if label['name'] == label_data['name']:
                print("Found it!", label)
                return {
                    'id': label['id'],
                    'name': label['name'],
                    'exists': False
                }     
                                       
    def update_annotation_labels(self, task_id, annotation_ids, new_label_id):
        """Update annotation label (single)"""
        with self.get_client() as client:
            task_id = int(task_id)
            if not isinstance(annotation_ids, list):
                annotation_ids_list = [int(annotation_ids)]
            else:
                annotation_ids_list = [int(aid) for aid in annotation_ids]

            new_label_id = int(new_label_id)

            annotations, _ = client.tasks.api.retrieve_annotations(task_id)
            
            shapes_to_patch = []
            for annotation in annotations["shapes"]:
                if annotation.id in annotation_ids_list:
                    shape_dict = annotation.to_dict()
                    shape_dict['label_id'] = new_label_id   
                    shape_dict['attributes'] = []  # Clear attributes if needed         
                    shapes_to_patch.append(shape_dict)

            print(f"Annotations to update: {shapes_to_patch}")

            # Prepare the request body
            update_request = PatchedLabeledDataRequest(shapes=shapes_to_patch)
            print(update_request)

            print(f"Update request prepared")
            _, http_response  = client.tasks.api.partial_update_annotations(
                "update",id=task_id, patched_labeled_data_request=update_request
            )
            if 200 <= http_response.status < 300:
                print("Annotations updated successfully.")
                # You might want to inspect response_data if needed
                return 'success'
            else:
                print(f"Failed to update annotations. Status: {http_response.status}, Response: {http_response.data}")
                return 'failed'