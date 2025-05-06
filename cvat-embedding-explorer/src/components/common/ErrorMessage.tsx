// src/components/common/ErrorMessage.tsx
import React from 'react';
import { Alert, Button } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';

interface ErrorMessageProps {
  message: string;
  onRetry?: () => void;
}

const ErrorMessage: React.FC<ErrorMessageProps> = ({ 
  message, 
  onRetry 
}) => {
  return (
    <div style={{ 
      display: 'flex', 
      flexDirection: 'column', 
      alignItems: 'center',
      padding: '24px'
    }}>
      <Alert
        message="Error"
        description={message}
        type="error"
        showIcon
        style={{ marginBottom: onRetry ? '16px' : 0, maxWidth: '500px' }}
      />
      
      {onRetry && (
        <Button 
          type="primary" 
          icon={<ReloadOutlined />} 
          onClick={onRetry}
        >
          Retry
        </Button>
      )}
    </div>
  );
};

export default ErrorMessage;
