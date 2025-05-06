// src/App.tsx
import React from 'react';
import { BrowserRouter as Router, Route, Switch } from 'react-router-dom';
import { Layout } from 'antd';
import ProjectsList from './components/ProjectsList/ProjectsList';
import ClusterExplorer from './components/ClusterExplorer/ClusterExplorer';
import './styles/index.scss';

const { Header, Content } = Layout;

const App: React.FC = () => {
  return (
    <Router>
      <Layout className="cvat-layout">
        <Header className="cvat-header">
          <div className="cvat-logo">CVAT Embedding Explorer</div>
        </Header>
        <Layout className="cvat-workspace">
          <Content className="cvat-content">
            <Switch>
              <Route path="/" exact component={ProjectsList} />
              <Route path="/project/:projectId" component={ClusterExplorer} />
            </Switch>
          </Content>
        </Layout>
      </Layout>
    </Router>
  );
};

export default App;
