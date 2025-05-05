import cvat_sdk
import cvat_sdk.api_client
import cvat_sdk.core
from cvat_sdk.api_client import ApiClient, Configuration
from cvat_sdk.core.proxies.tasks import ResourceType, Task
from cvat_sdk import make_client
from PIL import Image



host='http://192.168.2.88'
username='justin.kopacz@ozniai.com'
password='password'
port='8080'


with make_client(host, port=port, credentials=(username, password)) as client:
    # task = client.tasks.retrieve(4)
    projects = client.projects.list()
    project_id = 0
    for project in projects:
        print(project.id)
        print(project.name)
        print(project.tasks)
        project_id = project.id

    tasks = client.tasks.list()
    for task in tasks:
        if task.project_id == project_id:
            print(task)

        annotations = task.get_annotations()


        # Print shapes (bounding boxes, polygons, etc.)
        print("Shapes:")
        for shape in annotations.shapes:
            print(f"Frame: {shape.frame}")
            print(f"Label: {shape.label_id}")
            print(f"Type: {shape.type}")
            print(f"Points: {shape.points}")
            print(f"Attributes: {shape.attributes}")
            print("---")

        # Print tags
        print("\nTags:")
        for tag in annotations.tags:
            print(f"Frame: {tag.frame}")
            print(f"Label: {tag.label_id}")
            print(f"Attributes: {tag.attributes}")
            print("---")

        # Print tracks (for video annotations)
        print("\nTracks:")
        for track in annotations.tracks:
            print(f"Label: {track.label_id}")
            print("Track shapes:")
            for shape in track.shapes:
                print(f"  Frame: {shape.frame}")
                print(f"  Points: {shape.points}")
                print(f"  Outside: {shape.outside}")
                print(f"  Attributes: {shape.attributes}")
            print("---")
    frame_data = task.get_frame(0)

    # Convert to PIL Image and save as PNG
    image = Image.open(frame_data)
    image.save('frame_0.png', 'PNG')