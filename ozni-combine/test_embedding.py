import requests
import time
import json
import argparse
import os
from pprint import pprint
import services.embedding_service as embedding_service
from services.cvat_service import CVATService
cvat_service = CVATService()


class APITester:
    def __init__(self, base_url="http://localhost:5000"):
        self.base_url = base_url
        self.job_id = None
        self.project_id = None
        self.task_id = None

    def test_get_projects(self):
        """Test the projects endpoint"""
        print("\n=== Testing GET /api/projects ===")
        print(f"{self.base_url}/api/projects")
        response = requests.get(f"{self.base_url}/api/projects")

        if response.status_code == 200:
            projects = response.json()
            print(f"Found {len(projects)} projects")
            if projects:
                self.project_id = projects[0]['id']
                self.project_id = 5 #specific test project
                print(f"Selected project ID: {self.project_id}")
                pprint(projects[0])
            return projects
        else:
            print(f"Error: {response.status_code}")
            print(response.text)
            return None

    def test_get_tasks(self):
        """Test the tasks endpoint"""
        print("\n=== Testing GET /api/tasks ===")
        if not self.project_id:
            print("No project ID available. Skipping task test.")
            return None

        response = requests.get(f"{self.base_url}/api/tasks", params={"project_id": self.project_id})

        if response.status_code == 200:
            tasks = response.json()
            print(f"Found {len(tasks)} tasks for project {self.project_id}")
            if tasks:
                self.task_id = tasks[0]['id']
                print(f"Selected task ID: {self.task_id}")
                pprint(tasks[0])
            return tasks
        else:
            print(f"Error: {response.status_code}")
            print(response.text)
            return None

    def test_get_annotations(self):
        """Test the annotations endpoint"""
        print("\n=== Testing GET /api/annotations ===")
        if not self.task_id:
            print("No task ID available. Skipping annotations test.")
            return None

        response = requests.get(f"{self.base_url}/api/annotations", params={"task_id": self.task_id})

        if response.status_code == 200:
            annotations = response.json()
            print(f"Found {len(annotations)} annotations for task {self.task_id}")
            if annotations:
                print("Sample annotation:")
                pprint(annotations[0])
            return annotations
        else:
            print(f"Error: {response.status_code}")
            print(response.text)
            return None


    def test_chip_image(self):
        """Test retrieving a chip image"""
        print("\n=== Testing GET /api/chip/{project_id}/{filename} ===")

        if not self.project_id:
            print("No project ID available. Skipping chip image test.")
            return None

        # First get visualization data to get a filename
        viz_data = self.test_visualization()
        if not viz_data or not viz_data.get('points'):
            print("No visualization data available. Skipping chip image test.")
            return None

        # Get the first filename
        filename = viz_data['points'][0]['filename']
        print(f"Retrieving chip image: {filename}")

        t=time.time()
        response = requests.get(f"{self.base_url}/api/chip/{self.project_id}/{filename}", stream=True)
        print(f"Time taken: {time.time() - t} seconds")

        if response.status_code == 200:
            # Save the image
            os.makedirs("test_output", exist_ok=True)
            image_path = os.path.join("test_output", filename)
            with open(image_path, "wb") as f:
                for chunk in response.iter_content(chunk_size=8192):
                    f.write(chunk)
            print(f"Saved chip image to {image_path}")
            return image_path
        else:
            print(f"Error: {response.status_code}")
            print(response.text)
            return None

    def test_get_embeddings(self, task_ids=None, feature_type="both", chip_limit=10, recalculate=False):
        """Test the get_embeddings endpoint which handles the entire workflow"""
        print("\n=== Testing POST /api/embeddings/get ===")

        if not self.project_id:
            print("No project ID available. Skipping get_embeddings test.")
            return None

        if not task_ids and not self.task_id:
            print("No task IDs available. Skipping get_embeddings test.")
            return None

        if not task_ids:
            task_ids = [self.task_id]

        data = {
            "project_id": self.project_id,
            "task_ids": task_ids,
            "feature_type": feature_type,
            "chip_limit": chip_limit,
            "recalculate": recalculate
        }

        if recalculate:
            print("Requesting recalculation of embeddings (ignoring existing data)")

        response = requests.post(f"{self.base_url}/api/embeddings/get", json=data)

        if response.status_code == 200:
            result = response.json()
            status = result["status"]
            print(f"Embeddings status: {status}")

            if status == "available":
                print(f"Embeddings are available from: {result['location']}")
                return result
            elif status == "started":
                self.job_id = result["job_id"]
                print(f"Started new embedding job with ID: {self.job_id}")
                print(f"For project ID: {result['project_id']}")

                # Wait for job completion
                job_completed = self.test_embedding_status(max_wait_time=300)
                if job_completed:
                    return {"status": "completed", "project_id": self.project_id}
                else:
                    return {"status": "incomplete", "project_id": self.project_id}
            else:
                print(f"Unexpected status: {status}")
                return result
        else:
            print(f"Error: {response.status_code}")
            print(response.text)
            return None

    def test_single_chip(self, task_id, frame_id, annotation_id, semantic_model=None, lvlm_prompt=None):
        """Test generating a description for a single chip"""
        print(f"\n=== Testing chip description for task {task_id}, frame {frame_id}, annotation {annotation_id} ===")

        try:
            # Get frame data directly from CVAT
            print("Fetching frame data...")
            frame_data = cvat_service.get_frame(task_id, frame_id)

            # Get annotations to find the shape
            print("Fetching annotations...")
            annotations = cvat_service.get_annotations(task_id)
            shape = next((s for s in annotations if str(s['id']) == str(annotation_id)), None)

            if not shape:
                print(f"Error: Annotation {annotation_id} not found")
                return None

            # Initialize embedding service
            embedding_service_instance = embedding_service.EmbeddingService()

            # Extract the chip
            print("Extracting chip...")
            chip = embedding_service_instance.extract_chip(frame_data, shape, over_clip=1.0)
            inflation_tries = 5
            over_clip = 1.0
            while min(chip.size) < 140 and inflation_tries > 0:
                print(f"Chip dimensions: {chip.size}, trying again with over_clip {over_clip}")
                chip = embedding_service_instance.extract_chip(frame_data, shape, over_clip=over_clip)
                over_clip += 1
                inflation_tries -= 1
            print(f"Chip dimensions: {chip.size}")

            if chip is None:
                print("Error: Failed to extract chip")
                return None

            # Generate description
            print("Generating description...")
            description = embedding_service_instance.generate_description(
                chip,
                semantic_model=semantic_model or "llava",  # Default to llava if not specified
                lvlm_prompt=lvlm_prompt or "Describe this image in detail."
            )

            print("\nResults:")
            print(f"Description: {description}")

            # Save the chip for reference
            os.makedirs("test_output", exist_ok=True)
            chip_filename = f"test_output/chip_task{task_id}_frame{frame_id}_anno{annotation_id}.png"
            chip.save(chip_filename)
            print(f"Saved chip to: {chip_filename}")

            return {
                "chip_path": chip_filename,
                "description": description
            }

        except Exception as e:
            print(f"Error testing single chip: {e}")
            import traceback
            traceback.print_exc()
            return None

    def run_all_tests(self, wait_time=300, chip_limit=10, test_recalculate=False):
        """Run all tests in sequence"""
        print("Starting API test sequence...")

        # Test basic endpoints
        self.test_get_projects()
        self.test_get_tasks()
        self.test_check_embeddings()
        self.test_get_annotations()

        # Test the combined get_embeddings workflow

            # Test recalculation if requested
        if test_recalculate:
            print("\n=== Testing recalculation of embeddings ===")
            recalc_result = self.test_get_embeddings(chip_limit=chip_limit, recalculate=True)
            if recalc_result and (recalc_result["status"] == "available" or recalc_result["status"] == "completed"):
                print("Recalculation successful!")

        embeddings_result = self.test_get_embeddings(chip_limit=chip_limit)

        if embeddings_result and (embeddings_result["status"] == "available" or embeddings_result["status"] == "completed"):
            # Test analysis endpoints
            self.test_clustering()
            self.test_visualization()
            self.test_chip_image()


        print("\nAPI test sequence completed!")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Test the CVAT embedding API")
    parser.add_argument("--url", default="http://192.168.2.88:5000", help="Base URL of the API")
    parser.add_argument("--wait", type=int, default=300, help="Maximum wait time for job completion (seconds)")
    # Add new arguments for single chip testing
    parser.add_argument("--task-id", type=int, help="Task ID for single chip test")
    parser.add_argument("--frame-id", type=int, help="Frame ID for single chip test")
    parser.add_argument("--annotation-id", type=str, help="Annotation ID for single chip test")
    parser.add_argument("--semantic-model", help="Semantic model to use (e.g., llava, gpt-4-vision-preview)", default="gpt-4.1-mini") #gpt-4o
    # parser.add_argument("--semantic-model", help="Semantic model to use (e.g., llava, gpt-4-vision-preview)", default="gpt-4.1-mini")
    parser.add_argument("--lvlm-prompt", help="Custom prompt for the LVLM", default="Describe the military object centered in this image. \
It might be contain a small landing craft air cushion (LCAC with twin engines), humvee, light armored vehicle (LAV), osprey, armored recovery vehicle (ARV), abrams tank, \
howitzer cannon, or a landing craft utility ship (LCU). Look closely and be concise about what it is. The object centered is:")

    args = parser.parse_args()

    tester = APITester(base_url=args.url)

    # If single chip test parameters are provided, run that instead of the full test
    result = tester.test_single_chip(
        args.task_id,
        args.frame_id,
        args.annotation_id,
        args.semantic_model,
        args.lvlm_prompt
    )
