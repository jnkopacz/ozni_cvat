import cvat_sdk
from cvat_sdk import make_client
from PIL import Image
import os
from ollama import Client
import io

# Connect to CVAT server
host = 'http://192.168.2.88'
username = 'justin.kopacz@ozniai.com'
password = 'password'
port = '8080'

CHIP_LIMIT = 500

def save_chips(image, shapes, task_id, job_id, frame_id):
    """Crop and save individual chips from the image based on bounding boxes and get AI descriptions"""
    # Create output directory if it doesn't exist
    output_dir = './sample_chips'
    os.makedirs(output_dir, exist_ok=True)

    # Initialize Ollama client
    ollama_client = Client(host='http://localhost:11434')

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

            # Convert chip to bytes for Ollama
            chip_bytes = io.BytesIO()
            chip.save(chip_bytes, format='PNG')
            chip_bytes = chip_bytes.getvalue()

            # Get description from Ollama
            # prompt = "What type of aircraft is shown in this image? Describe the wing shape, number of engines, tail configuration."

            prompt = "This image was collected from a satellite. Respond with a brief, one-line description of the object. This image shows:"
            # prompt = "This image was collected from a satellite. What is the single object shown in this image? Respond with a brief, one-line description of the object. This image shows:"
            # prompt = "This image was collected from a satellite. Respond with a brief, one-line description of the object including color, size, and observable features. This image shows:"
            # lvlm = "gemma3:27b"
            # lvlm = "gemma3:12b"
            lvlm = "llava:7b"
            # lvlm = "mistral-small3.1"
            response = ollama_client.generate(
                model=lvlm,
                prompt=prompt,
                images=[chip_bytes]
            )

            print(response.response)

            # Save description to a companion text file
            desc_filename = f"{filename[:-4]}_description.txt"
            with open(desc_filename, 'w') as f:
                f.write(response.response)
            print(f"Saved description to {desc_filename}")

            chip_count += 1
            if chip_count >= CHIP_LIMIT:  # Limit to first 100 chips
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

            if total_chips >= CHIP_LIMIT:
                print(f"Saved {total_chips} chips")
                break

        if total_chips >= CHIP_LIMIT:
            break

print(f"Finished saving {total_chips} chips")