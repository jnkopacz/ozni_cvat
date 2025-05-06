import requests
import time
import json
import argparse
import os
from pprint import pprint

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
                self.project_id = 1
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

    def test_check_embeddings(self):
        """Test checking if embeddings exist for a project ID"""
        print("\n=== Testing GET /api/embeddings/check ===")

        if not self.project_id:
            print("No project ID available. Skipping embeddings check.")
            return None

        response = requests.get(f"{self.base_url}/api/embeddings/check", params={"project_id": self.project_id})

        if response.status_code == 200:
            result = response.json()
            print(f"Embeddings exist: {result['exists']}")
            if result.get('exists'):
                print(f"Location: {result['location']}")
            return result
        else:
            print(f"Error: {response.status_code}")
            print(response.text)
            return None

    def test_start_embedding_job(self, task_ids=None, feature_type="both", chip_limit=10):
        """Test starting an embedding job"""
        print("\n=== Testing POST /api/embeddings/start ===")

        if not self.project_id:
            print("No project ID available. Skipping embedding job test.")
            return None

        if not task_ids and not self.task_id:
            print("No task IDs available. Skipping embedding job test.")
            return None

        if not task_ids:
            task_ids = [self.task_id]

        data = {
            "project_id": self.project_id,
            "task_ids": task_ids,
            "feature_type": feature_type,
            "chip_limit": chip_limit
        }

        response = requests.post(f"{self.base_url}/api/embeddings/start", json=data)

        if response.status_code == 200:
            result = response.json()
            self.job_id = result["job_id"]
            print(f"Started embedding job with ID: {self.job_id}")
            print(f"For project ID: {result['project_id']}")
            print(f"Initial status: {result['status']}")
            return result
        else:
            print(f"Error: {response.status_code}")
            print(response.text)
            return None

    def test_embedding_status(self, max_wait_time=300):
        """Test checking embedding job status with polling"""
        print(f"\n=== Testing GET /api/embeddings/status/{self.job_id} ===")

        if not self.job_id:
            print("No job ID available. Skipping status check.")
            return None

        start_time = time.time()
        completed = False

        while time.time() - start_time < max_wait_time:
            response = requests.get(f"{self.base_url}/api/embeddings/status/{self.job_id}")

            if response.status_code == 200:
                status_data = response.json()
                print(f"Job status: {status_data['status']}, Progress: {status_data['progress']}%")

                if status_data['status'] == "completed":
                    completed = True
                    break
                elif status_data['status'] == "failed":
                    print(f"Job failed: {status_data.get('error', 'Unknown error')}")
                    break

                # Wait before polling again
                time.sleep(5)
            else:
                print(f"Error checking status: {response.status_code}")
                print(response.text)
                break

        if not completed and time.time() - start_time >= max_wait_time:
            print(f"Timed out waiting for job completion after {max_wait_time} seconds")

        return completed

    def test_load_embeddings(self):
        """Test loading embeddings from disk"""
        print("\n=== Testing POST /api/embeddings/load ===")

        if not self.project_id:
            print("No project ID available. Skipping embeddings load.")
            return None

        data = {
            "project_id": self.project_id
        }

        response = requests.post(f"{self.base_url}/api/embeddings/load", json=data)

        if response.status_code == 200:
            result = response.json()
            print(f"Load successful: {result['success']}")
            if result.get('success'):
                print(f"Location: {result['location']}")
            return result
        else:
            print(f"Error: {response.status_code}")
            print(response.text)
            return None

    def test_clustering(self, min_cluster_size=5, min_samples=5, clustering_dims=5, reduction_method="umap"):
        """Test the clustering endpoint"""
        print("\n=== Testing POST /api/clustering ===")

        if not self.project_id:
            print("No project ID available. Skipping clustering test.")
            return None

        data = {
            "project_id": self.project_id,
            "min_cluster_size": min_cluster_size,
            "min_samples": min_samples,
            "clustering_dims": clustering_dims,
            "reduction_method": reduction_method
        }

        response = requests.post(f"{self.base_url}/api/clustering", json=data)

        if response.status_code == 200:
            result = response.json()
            print(f"Clustering completed with {result['num_clusters']} clusters")
            print(f"Noise points: {result['num_noise_points']}")
            return result
        else:
            print(f"Error: {response.status_code}")
            print(response.text)
            return None

    def test_visualization(self, display_dims=3, reduction_method="pca"):
        """Test the visualization endpoint"""
        print("\n=== Testing POST /api/visualization ===")

        if not self.project_id:
            print("No project ID available. Skipping visualization test.")
            return None

        data = {
            "project_id": self.project_id,
            "display_dims": display_dims,
            "reduction_method": reduction_method
        }

        response = requests.post(f"{self.base_url}/api/visualization", json=data)

        if response.status_code == 200:
            result = response.json()
            print(f"Visualization data generated for {len(result['points'])} points")
            print(f"Dimensions: {result['dimensions']}, Method: {result['reduction_method']}")

            # Save a sample of the visualization data
            os.makedirs("test_output", exist_ok=True)
            with open("test_output/visualization_sample.json", "w") as f:
                json.dump(result['points'][:5], f, indent=2)
            print("Saved sample visualization data to test_output/visualization_sample.json")

            return result
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
    parser.add_argument("--chip-limit", type=int, default=50, help="Maximum number of chips to process")
    parser.add_argument("--test-recalculate", action="store_true", help="Test recalculation of embeddings")

    args = parser.parse_args()

    tester = APITester(base_url=args.url)
    tester.run_all_tests(wait_time=args.wait, chip_limit=args.chip_limit, test_recalculate=args.test_recalculate)