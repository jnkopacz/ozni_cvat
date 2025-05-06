// src/components/common/LoadingSpinner.tsx
import React from 'react';
import { Spin, Typography } from 'antd';

const { Text } = Typography;

interface LoadingSpinnerProps {
  message?: string;
}

const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({ 
  message = 'Loading...' 
}) => {
  return (
    <div style={{ 
      display: 'flex', 
      flexDirection: 'column', 
      justifyContent: 'center', 
      alignItems: 'center',
      padding: '24px'
    }}>
      <Spin size="large" />
      <Text style={{ marginTop: '16px' }}>{message}</Text>
    </div>
  );
};

export default LoadingSpinner;
