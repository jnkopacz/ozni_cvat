import numpy as np
from sklearn.decomposition import PCA
import umap
import hdbscan
from sklearn.preprocessing import StandardScaler

class ClusteringService:
    def __init__(self):
        pass

    def reduce_dimensions(self, embeddings, n_components, method='pca'):
        """Reduce dimensionality using either PCA or UMAP"""
        if method.lower() == 'pca':
            reducer = PCA(n_components=n_components)
        else:  # umap
            reducer = umap.UMAP(n_components=n_components, random_state=42)

        reduced_embeddings = reducer.fit_transform(embeddings)

        if method.lower() == 'pca':
            print(f"Explained variance ratio: {reducer.explained_variance_ratio_}")
            print(f"Cumulative explained variance: {np.cumsum(reducer.explained_variance_ratio_)}")

        return reduced_embeddings, reducer

    def cluster_embeddings(self, embeddings, min_cluster_size=5, min_samples=5, n_components=10, reduction_method='pca'):
        """Cluster embeddings using HDBSCAN on dimensionality-reduced features"""
        # First reduce dimensionality
        reduced_embeddings, reducer = self.reduce_dimensions(
            embeddings,
            n_components=n_components,
            method=reduction_method
        )

        # Scale the reduced embeddings
        scaler = StandardScaler()
        scaled_embeddings = scaler.fit_transform(reduced_embeddings)

        # Apply HDBSCAN
        clusterer = hdbscan.HDBSCAN(
            min_cluster_size=min_cluster_size,
            min_samples=min_samples,
            prediction_data=True
        )
        clusters = clusterer.fit_predict(scaled_embeddings)

        # Print clustering statistics
        n_clusters = len(set(clusters)) - (1 if -1 in clusters else 0)
        n_noise = list(clusters).count(-1)
        print(f"Number of clusters: {n_clusters}")
        print(f"Number of noise points: {n_noise}")

        return clusters, reducer