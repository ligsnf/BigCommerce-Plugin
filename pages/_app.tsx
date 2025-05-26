import { Box, GlobalStyles, Alert } from '@bigcommerce/big-design';
import { theme as defaultTheme } from '@bigcommerce/big-design-theme';
import type { AppProps } from 'next/app';
import { ThemeProvider } from 'styled-components';
import Header from '../components/header';
import SessionProvider from '../context/session';
import { alertsManager } from '../lib/alerts';
import { useEffect, useState } from 'react';

const MyApp = ({ Component, pageProps }: AppProps) => {
    const [alerts, setAlerts] = useState([]);

    useEffect(() => {
        const unsubscribe = alertsManager.subscribe(setAlerts);
        return () => unsubscribe();
    }, []);

    return (
        <ThemeProvider theme={defaultTheme}>
            <GlobalStyles />
            {alerts.map((alert, index) => (
                <Alert key={index} {...alert} />
            ))}
            <Box
                marginHorizontal={{ mobile: 'none', tablet: 'xxxLarge' }}
                marginVertical={{ mobile: 'none', tablet: "xxLarge" }}
            >
                <Header />
                <SessionProvider>
                    <Component {...pageProps} />
                </SessionProvider>
            </Box>
        </ThemeProvider>
    );
};

export default MyApp;
