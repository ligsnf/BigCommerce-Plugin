import { AlertProps } from '@bigcommerce/big-design';

class AlertsManager {
    private alerts: AlertProps[] = [];
    private subscribers: ((alerts: AlertProps[]) => void)[] = [];

    add(alert: AlertProps) {
        this.alerts = [...this.alerts, alert];
        this.notifySubscribers();
    }

    remove(alert: AlertProps) {
        this.alerts = this.alerts.filter(a => a !== alert);
        this.notifySubscribers();
    }

    subscribe(callback: (alerts: AlertProps[]) => void) {
        this.subscribers.push(callback);

        return () => {
            this.subscribers = this.subscribers.filter(cb => cb !== callback);
        };
    }

    private notifySubscribers() {
        this.subscribers.forEach(callback => callback(this.alerts));
    }
}

export const alertsManager = new AlertsManager(); 