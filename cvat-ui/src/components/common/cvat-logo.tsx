// Copyright (C) CVAT.ai Corporation
//
// SPDX-License-Identifier: MIT

import React from 'react';
import { useSelector } from 'react-redux';
import { CombinedState } from 'reducers';

function CVATLogo(): JSX.Element {
    const logo = useSelector((state: CombinedState) => state.about.server.logoURL);

    return (
        <div className='cvat-logo-icon' style={{ display: 'flex', alignItems: 'center' }}>
            <img src={logo} alt='CVAT Logo' />
            <img src='/assets/logo_ozni_black.png' alt='OZNI Logo' style={{ marginLeft: '10px', height: '23px' }} />
        </div>
    );
}

export default React.memo(CVATLogo);
