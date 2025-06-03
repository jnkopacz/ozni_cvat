#!/usr/bin/env python3
"""
Test script for CVAT integration endpoints
Tests label creation and annotation update functionality
"""

import requests
import json
import sys
from typing import Dict, Any

# Configuration
API_BASE_URL = "http://localhost:5000/api"
TEST_PROJECT_ID = 5  # Update this to match your test project

def test_endpoint(method: str, url: str, data: Dict[Any, Any] = None, params: Dict[str, Any] = None) -> Dict[Any, Any]:
    """Helper function to test API endpoints"""
    try:
        if method.upper() == 'GET':
            response = requests.get(url, params=params)
        elif method.upper() == 'POST':
            response = requests.post(url, json=data)
        elif method.upper() == 'PUT':
            response = requests.put(url, json=data)
        else:
            raise ValueError(f"Unsupported method: {method}")
        
        print(f"{method} {url}")
        print(f"Status: {response.status_code}")
        
        if response.status_code == 200:
            result = response.json()
            print(f"Response: {json.dumps(result, indent=2)}")
            return result
        else:
            print(f"Error: {response.text}")
            return {"error": response.text, "status_code": response.status_code}
            
    except Exception as e:
        print(f"Exception: {e}")
        return {"error": str(e)}

def test_label_creation():
    """Test label creation and retrieval"""
    print("\n" + "="*50)
    print("TESTING LABEL MANAGEMENT")
    print("="*50)
    
    # Test getting existing labels
    print("\n1. Getting existing project labels...")
    labels_response = test_endpoint(
        'GET', 
        f"{API_BASE_URL}/projects/{TEST_PROJECT_ID}/labels"
    )
    
    existing_labels = labels_response.get('labels', []) if 'labels' in labels_response else []
    print(f"Found {len(existing_labels)} existing labels")
    
    # Test creating a new label
    print("\n2. Creating a new test label...")
    new_label_data = {
        "name": "vehicle",
        "color": "#00ff00",
        "attributes": [
            {
                "name": "confidence",
                "input_type": "number",
                "mutable": True,
                "default_value": "0.5",
                "values": []
            }
        ]
    }
    
    create_response = test_endpoint(
        'POST',
        f"{API_BASE_URL}/projects/{TEST_PROJECT_ID}/labels",
        new_label_data
    )
    
    if 'label' in create_response:
        new_label_id = create_response['label']['id']
        print(f"Created label with ID: {new_label_id}")
        return new_label_id
    else:
        print("Failed to create label")
        return None

def test_annotation_update(new_label_id: int = None):
    """Test annotation retrieval and updates"""
    print("\n" + "="*50)
    print("TESTING ANNOTATION MANAGEMENT")
    print("="*50)
    
    # Test getting annotations with labels
    print("\n1. Getting task ids for project...")
    response = requests.get(f"{API_BASE_URL}/tasks", params={"project_id": TEST_PROJECT_ID})
    task_ids = []
    if response.status_code == 200:
        tasks = response.json()
        print(f"Found {len(tasks)} tasks for project {TEST_PROJECT_ID}")
        for task in tasks:
            task_ids.append(task['id'])
    print(f"Task IDs: {task_ids}")
    if not task_ids:
        print("No tasks found for project - skipping annotation tests")
        return

    project_annotations = []
    for task_id in task_ids:
        print(f"\n2. Getting annotations for task ID {task_id}...")
        response = requests.get(f"{API_BASE_URL}/annotations", params={"task_id": task_id})
        if response.status_code != 200:
            print(f"Failed to get annotations for task {task_id}: {response.text}")
            continue
        annotations = response.json()
        print(f"Found {len(annotations)} annotations for task {task_id}")
        if len(annotations) == 0:
            print("No annotations found for task - skipping update tests")
            continue
        project_annotations.extend(annotations)

    annotations = project_annotations
    if not annotations:
        print("No annotations found in project - skipping update tests")
        return
    
    print(f"\n3. Assigning labels to {len(annotations)} annotations...")

    
    # annotation_ids = [x['id'] for x in annotations[:10000]]
    annotation_ids = [x['id'] for x in annotations[:10000000]]    

    
    print(f"Testing with annotation IDs: {annotation_ids}")
    if not new_label_id:
        print("No new label ID provided - skipping annotation update tests")
        return
    print(f"\n2. Updating annotation assignments to new label ID: {new_label_id}...")


    # Test validation before update
    for task_id in task_ids:
        print("Updating for task ID:", task_id)

        data = {"annotation_ids": annotation_ids,
            "new_label_id": new_label_id,
            "task_id": task_id}
        print(f"Validation data: {json.dumps(data, indent=2)}")
        validation_response = test_endpoint(
            'POST',
            f"{API_BASE_URL}/annotations/update",
            data
        )
        print(f"Validation response: {validation_response}")
      
def main():
    """Main test function"""
    print("🧪 Testing CVAT Integration Endpoints")
    print(f"API Base URL: {API_BASE_URL}")
    print(f"Test Project ID: {TEST_PROJECT_ID}")
    
    # Test label management
    new_label_id = test_label_creation()
    
    # Test annotation management
    test_annotation_update(new_label_id)

    
    print("\n" + "="*50)
    print("TESTING COMPLETE")
    print("="*50)

if __name__ == "__main__":
    main()
