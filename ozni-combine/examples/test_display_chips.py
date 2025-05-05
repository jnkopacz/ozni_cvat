import cvat_sdk
from cvat_sdk import make_client
from PIL import Image
import os

# Connect to CVAT server
host = 'http://192.168.2.88'
username = 'justin.kopacz@ozniai.com'
password = 'password'
port = '8080'

def save_chips(image, shapes, task_id, job_id, frame_id):
    """Crop and save individual chips from the image based on bounding boxes"""
    # Create output directory if it doesn't exist
    output_dir = './sample_chips'
    os.makedirs(output_dir, exist_ok=True)

    chip_count = 0
    for shape in shapes:
        shape_type = str(shape.type).split('.')[-1].lower()

        if shape_type == "rectangle":
            # Rectangle points are [x1, y1, x2, y2]
            x1, y1, x2, y2 = shape.points
            # Convert to integers for cropping
            x1, y1, x2, y2 = int(x1), int(y1), int(x2), int(y2)

            # Crop the region
            chip = image.crop((x1, y1, x2, y2))

            # Save with descriptive filename
            filename = f"{output_dir}/task{task_id}_job{job_id}_frame{frame_id}_anno{shape.id}.png"
            chip.save(filename)

            chip_count += 1
            if chip_count >= 100:  # Limit to first 100 chips
                return chip_count

    return chip_count

# Connect to CVAT
with make_client(host, port=port, credentials=(username, password)) as client:
    total_chips = 0

    # Get tasks
    tasks = client.tasks.list()

    for task in tasks:
        # Get annotations for the task
        annotations = task.get_annotations()

        # Process frames until we get 100 chips
        for frame_idx in range(len(task.get_frames_info())):
            # Get the frame image
            frame_data = task.get_frame(frame_idx)
            image = Image.open(frame_data)

            # Get shapes for this frame
            frame_shapes = [shape for shape in annotations.shapes
                          if shape.frame == frame_idx]

            # Save chips from this frame
            chips_saved = save_chips(image, frame_shapes, task.id, task.id, frame_idx)
            total_chips += chips_saved

            if total_chips >= 100:
                print(f"Saved {total_chips} chips")
                break

        if total_chips >= 100:
            break

print(f"Finished saving {total_chips} chips")