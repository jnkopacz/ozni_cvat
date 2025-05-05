#use pytorch latest
FROM pytorch/pytorch:latest

#install dependencies

RUN apt-get update && apt-get install -y x11-apps

RUN pip install --upgrade pip

RUN pip install cvat-sdk==2.34 ollama scikit-learn matplotlib plotly pandas hdbscan umap-learn
RUN pip install torch transformers
RUN pip install flask==2.3.3 flask-cors==4.0.0 cvat-sdk==2.5.0 Pillow==10.0.0
RUN pip install tqdm


RUN apt-get install -y build-essential

COPY . /app

WORKDIR /app

# CMD ["python", "app.py"]
