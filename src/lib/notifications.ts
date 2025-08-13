export type NotificationType = 'success' | 'error' | 'warning' | 'info';

export interface Notification {
  id: string;
  type: NotificationType;
  message: string;
  title?: string;
  duration?: number;
  timestamp: number;
}

class NotificationManager {
  private notifications: Notification[] = [];
  private listeners: ((notifications: Notification[]) => void)[] = [];

  addNotification(notification: Omit<Notification, 'id' | 'timestamp'>): string {
    const id = crypto.randomUUID();
    const fullNotification: Notification = {
      ...notification,
      id,
      timestamp: Date.now(),
      duration: notification.duration ?? 5000
    };

    this.notifications.push(fullNotification);
    this.notifyListeners();

    // Auto-remove after duration
    if (fullNotification.duration > 0) {
      setTimeout(() => {
        this.removeNotification(id);
      }, fullNotification.duration);
    }

    return id;
  }

  removeNotification(id: string): void {
    this.notifications = this.notifications.filter(n => n.id !== id);
    this.notifyListeners();
  }

  clearAll(): void {
    this.notifications = [];
    this.notifyListeners();
  }

  getNotifications(): Notification[] {
    return [...this.notifications];
  }

  subscribe(listener: (notifications: Notification[]) => void): () => void {
    this.listeners.push(listener);
    listener(this.notifications); // Initial call

    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  private notifyListeners(): void {
    this.listeners.forEach(listener => listener(this.notifications));
  }

  // Convenience methods
  success(message: string, title?: string, duration?: number): string {
    return this.addNotification({ type: 'success', message, title, duration });
  }

  error(message: string, title?: string, duration?: number): string {
    return this.addNotification({ type: 'error', message, title, duration });
  }

  warning(message: string, title?: string, duration?: number): string {
    return this.addNotification({ type: 'warning', message, title, duration });
  }

  info(message: string, title?: string, duration?: number): string {
    return this.addNotification({ type: 'info', message, title, duration });
  }
}

export const notificationManager = new NotificationManager();

// Chrome extension specific notifications
export const showChromeNotification = (title: string, message: string, type: NotificationType = 'info'): void => {
  if (chrome.notifications) {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: '/assets/icons/48.png',
      title,
      message,
      priority: type === 'error' ? 2 : 1
    });
  }
};

// Toast notification for side panel
export const createToastElement = (notification: Notification): HTMLElement => {
  const toast = document.createElement('div');
  toast.className = `toast toast-${notification.type}`;
  toast.innerHTML = `
    <div class="toast-header">
      <span class="toast-title">${notification.title || notification.type.toUpperCase()}</span>
      <button class="toast-close" aria-label="Close">×</button>
    </div>
    <div class="toast-message">${notification.message}</div>
  `;

  // Add close functionality
  const closeBtn = toast.querySelector('.toast-close');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      notificationManager.removeNotification(notification.id);
    });
  }

  return toast;
};
