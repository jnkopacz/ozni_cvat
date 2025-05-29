// src/App.tsx
import React from 'react';
import { BrowserRouter as Router, Route, Switch, Link } from 'react-router-dom';
import { Layout, Button } from 'antd';
import ProjectsList from './components/ProjectsList/ProjectsList';
import ClusterExplorer from './components/ClusterExplorer/ClusterExplorer';
import './styles/index.scss';

const { Header, Content } = Layout;

const App: React.FC = () => {
  return (
    <Router>
      <Layout className="cvat-layout">
        <Header className="cvat-header">
          <div className="cvat-left-header">
            <div className="cvat-logo-icon">
              <img src="/logo.svg" alt="CVAT Logo" />
              <img
                src="/logo_ozni_black.png"
                alt="OZNI Logo"
                style={{ marginLeft: '10px', height: '23px' }}
              />
            </div>
            <Button
              className="cvat-header-button"
              type="link"
              component={Link}
              to="/"
            >
              Object Embedding Explorer
            </Button>
          </div>
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
