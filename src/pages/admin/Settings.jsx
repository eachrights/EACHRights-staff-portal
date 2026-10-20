import { useState } from "react";
import {
  Settings as SettingsIcon,
  Building2,
  ShieldCheck,
  Bell,
  User,
  Save,
  Lock,
  Eye,
  EyeOff,
  CheckCircle2,
} from "lucide-react";

import Header from "../../components/Header";
import Sidebar from "../../components/Sidebar";

function Settings() {
  const [activeTab, setActiveTab] = useState("organization");
  const [saved, setSaved] = useState(false);

  const [organization, setOrganization] = useState({
    name: "East African Centre for Human Rights",
    acronym: "EACHRights",
    email: "",
    phone: "",
    website: "https://eachrights.or.ke",
    address: "Nairobi, Kenya",
  });

  const [security, setSecurity] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });

  const [notifications, setNotifications] = useState({
    emailNotifications: true,
    systemNotifications: true,
    documentNotifications: true,
    securityAlerts: true,
  });

  const [preferences, setPreferences] = useState({
    language: "English",
    timezone: "Africa/Nairobi",
    dateFormat: "DD/MM/YYYY",
  });

  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const handleOrganizationChange = (e) => {
    const { name, value } = e.target;

    setOrganization((previous) => ({
      ...previous,
      [name]: value,
    }));
  };

  const handleSecurityChange = (e) => {
    const { name, value } = e.target;

    setSecurity((previous) => ({
      ...previous,
      [name]: value,
    }));
  };

  const handleNotificationChange = (e) => {
    const { name, checked } = e.target;

    setNotifications((previous) => ({
      ...previous,
      [name]: checked,
    }));
  };

  const handlePreferenceChange = (e) => {
    const { name, value } = e.target;

    setPreferences((previous) => ({
      ...previous,
      [name]: value,
    }));
  };

  const handleSave = () => {
    setSaved(true);

    setTimeout(() => {
      setSaved(false);
    }, 3000);
  };

  const tabs = [
    {
      id: "organization",
      label: "Organization",
      icon: Building2,
    },
    {
      id: "security",
      label: "Security",
      icon: ShieldCheck,
    },
    {
      id: "notifications",
      label: "Notifications",
      icon: Bell,
    },
    {
      id: "preferences",
      label: "Preferences",
      icon: User,
    },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />

      <div className="flex">
        <Sidebar />

        <main className="flex-1 p-6 lg:p-8">
          {/* Page Header */}
          <div className="mb-8">
            <div className="mb-2 flex items-center gap-2 text-sm text-gray-500">
              <SettingsIcon size={16} />
              <span>Administration</span>
              <span>/</span>
              <span>Settings</span>
            </div>

            <h1 className="text-3xl font-bold text-gray-900">
              Settings
            </h1>

            <p className="mt-1 text-gray-600">
              Manage organization, security, notifications and portal
              preferences.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-4">
            {/* Settings Navigation */}
            <aside className="h-fit rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
              <div className="mb-3 px-3 py-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                  Settings
                </p>
              </div>

              <nav className="space-y-1">
                {tabs.map((tab) => {
                  const Icon = tab.icon;

                  return (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      className={`flex w-full items-center gap-3 rounded-lg px-4 py-3 text-left text-sm font-medium transition ${
                        activeTab === tab.id
                          ? "bg-green-50 text-green-700"
                          : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                      }`}
                    >
                      <Icon size={18} />
                      {tab.label}
                    </button>
                  );
                })}
              </nav>
            </aside>

            {/* Settings Content */}
            <section className="lg:col-span-3">
              {/* Organization */}
              {activeTab === "organization" && (
                <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
                  <div className="border-b border-gray-200 p-6">
                    <h2 className="text-lg font-semibold text-gray-900">
                      Organization Information
                    </h2>

                    <p className="mt-1 text-sm text-gray-500">
                      Update the organization details used throughout the
                      staff portal.
                    </p>
                  </div>

                  <div className="space-y-6 p-6">
                    <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                      <div>
                        <label className="mb-2 block text-sm font-medium text-gray-700">
                          Organization Name
                        </label>

                        <input
                          type="text"
                          name="name"
                          value={organization.name}
                          onChange={handleOrganizationChange}
                          className="w-full rounded-lg border border-gray-300 px-4 py-3 text-sm outline-none focus:border-green-600 focus:ring-2 focus:ring-green-100"
                        />
                      </div>

                      <div>
                        <label className="mb-2 block text-sm font-medium text-gray-700">
                          Acronym
                        </label>

                        <input
                          type="text"
                          name="acronym"
                          value={organization.acronym}
                          onChange={handleOrganizationChange}
                          className="w-full rounded-lg border border-gray-300 px-4 py-3 text-sm outline-none focus:border-green-600 focus:ring-2 focus:ring-green-100"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                      <div>
                        <label className="mb-2 block text-sm font-medium text-gray-700">
                          Email Address
                        </label>

                        <input
                          type="email"
                          name="email"
                          value={organization.email}
                          onChange={handleOrganizationChange}
                          placeholder="organization@example.org"
                          className="w-full rounded-lg border border-gray-300 px-4 py-3 text-sm outline-none focus:border-green-600 focus:ring-2 focus:ring-green-100"
                        />
                      </div>

                      <div>
                        <label className="mb-2 block text-sm font-medium text-gray-700">
                          Phone Number
                        </label>

                        <input
                          type="text"
                          name="phone"
                          value={organization.phone}
                          onChange={handleOrganizationChange}
                          placeholder="+254..."
                          className="w-full rounded-lg border border-gray-300 px-4 py-3 text-sm outline-none focus:border-green-600 focus:ring-2 focus:ring-green-100"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="mb-2 block text-sm font-medium text-gray-700">
                        Website
                      </label>

                      <input
                        type="url"
                        name="website"
                        value={organization.website}
                        onChange={handleOrganizationChange}
                        className="w-full rounded-lg border border-gray-300 px-4 py-3 text-sm outline-none focus:border-green-600 focus:ring-2 focus:ring-green-100"
                      />
                    </div>

                    <div>
                      <label className="mb-2 block text-sm font-medium text-gray-700">
                        Address
                      </label>

                      <textarea
                        name="address"
                        value={organization.address}
                        onChange={handleOrganizationChange}
                        rows="3"
                        className="w-full resize-none rounded-lg border border-gray-300 px-4 py-3 text-sm outline-none focus:border-green-600 focus:ring-2 focus:ring-green-100"
                      />
                    </div>

                    <SaveButton saved={saved} onClick={handleSave} />
                  </div>
                </div>
              )}

              {/* Security */}
              {activeTab === "security" && (
                <div className="space-y-6">
                  <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
                    <div className="border-b border-gray-200 p-6">
                      <h2 className="text-lg font-semibold text-gray-900">
                        Change Password
                      </h2>

                      <p className="mt-1 text-sm text-gray-500">
                        Update your administrator account password.
                      </p>
                    </div>

                    <div className="space-y-5 p-6">
                      <PasswordInput
                        label="Current Password"
                        name="currentPassword"
                        value={security.currentPassword}
                        onChange={handleSecurityChange}
                        visible={showCurrentPassword}
                        setVisible={setShowCurrentPassword}
                      />

                      <PasswordInput
                        label="New Password"
                        name="newPassword"
                        value={security.newPassword}
                        onChange={handleSecurityChange}
                        visible={showNewPassword}
                        setVisible={setShowNewPassword}
                      />

                      <PasswordInput
                        label="Confirm New Password"
                        name="confirmPassword"
                        value={security.confirmPassword}
                        onChange={handleSecurityChange}
                        visible={showConfirmPassword}
                        setVisible={setShowConfirmPassword}
                      />

                      <div className="rounded-lg bg-gray-50 p-4">
                        <div className="flex gap-3">
                          <Lock
                            size={18}
                            className="mt-0.5 text-gray-500"
                          />

                          <div>
                            <p className="text-sm font-medium text-gray-700">
                              Password requirements
                            </p>

                            <ul className="mt-2 space-y-1 text-xs text-gray-500">
                              <li>• At least 8 characters</li>
                              <li>
                                • Include uppercase and lowercase letters
                              </li>
                              <li>• Include at least one number</li>
                              <li>• Avoid easily guessed passwords</li>
                            </ul>
                          </div>
                        </div>
                      </div>

                      <SaveButton saved={saved} onClick={handleSave} />
                    </div>
                  </div>

                  <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
                    <div className="flex items-start gap-4 p-6">
                      <div className="rounded-lg bg-green-100 p-3 text-green-700">
                        <ShieldCheck size={24} />
                      </div>

                      <div>
                        <h3 className="font-semibold text-gray-900">
                          Administrator Security
                        </h3>

                        <p className="mt-1 text-sm leading-6 text-gray-500">
                          Administrator accounts should use strong,
                          unique passwords. Additional authentication
                          controls can be enabled when the portal
                          authentication system is connected.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Notifications */}
              {activeTab === "notifications" && (
                <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
                  <div className="border-b border-gray-200 p-6">
                    <h2 className="text-lg font-semibold text-gray-900">
                      Notification Settings
                    </h2>

                    <p className="mt-1 text-sm text-gray-500">
                      Choose which notifications you want to receive.
                    </p>
                  </div>

                  <div className="divide-y divide-gray-100">
                    <NotificationToggle
                      name="emailNotifications"
                      title="Email Notifications"
                      description="Receive important portal notifications by email."
                      checked={notifications.emailNotifications}
                      onChange={handleNotificationChange}
                    />

                    <NotificationToggle
                      name="systemNotifications"
                      title="System Notifications"
                      description="Receive updates about system activity and changes."
                      checked={notifications.systemNotifications}
                      onChange={handleNotificationChange}
                    />

                    <NotificationToggle
                      name="documentNotifications"
                      title="Document Notifications"
                      description="Receive notifications when documents are uploaded or updated."
                      checked={notifications.documentNotifications}
                      onChange={handleNotificationChange}
                    />

                    <NotificationToggle
                      name="securityAlerts"
                      title="Security Alerts"
                      description="Receive alerts about important security events."
                      checked={notifications.securityAlerts}
                      onChange={handleNotificationChange}
                    />
                  </div>

                  <div className="border-t border-gray-200 p-6">
                    <SaveButton saved={saved} onClick={handleSave} />
                  </div>
                </div>
              )}

              {/* Preferences */}
              {activeTab === "preferences" && (
                <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
                  <div className="border-b border-gray-200 p-6">
                    <h2 className="text-lg font-semibold text-gray-900">
                      Portal Preferences
                    </h2>

                    <p className="mt-1 text-sm text-gray-500">
                      Configure your preferred language, timezone and date
                      format.
                    </p>
                  </div>

                  <div className="space-y-6 p-6">
                    <div>
                      <label className="mb-2 block text-sm font-medium text-gray-700">
                        Language
                      </label>

                      <select
                        name="language"
                        value={preferences.language}
                        onChange={handlePreferenceChange}
                        className="w-full rounded-lg border border-gray-300 px-4 py-3 text-sm outline-none focus:border-green-600 focus:ring-2 focus:ring-green-100"
                      >
                        <option value="English">English</option>
                        <option value="Swahili">Swahili</option>
                      </select>
                    </div>

                    <div>
                      <label className="mb-2 block text-sm font-medium text-gray-700">
                        Timezone
                      </label>

                      <select
                        name="timezone"
                        value={preferences.timezone}
                        onChange={handlePreferenceChange}
                        className="w-full rounded-lg border border-gray-300 px-4 py-3 text-sm outline-none focus:border-green-600 focus:ring-2 focus:ring-green-100"
                      >
                        <option value="Africa/Nairobi">
                          Africa/Nairobi (EAT)
                        </option>
                        <option value="Africa/Kampala">
                          Africa/Kampala (EAT)
                        </option>
                        <option value="Africa/Dar_es_Salaam">
                          Africa/Dar_es_Salaam (EAT)
                        </option>
                        <option value="UTC">UTC</option>
                      </select>
                    </div>

                    <div>
                      <label className="mb-2 block text-sm font-medium text-gray-700">
                        Date Format
                      </label>

                      <select
                        name="dateFormat"
                        value={preferences.dateFormat}
                        onChange={handlePreferenceChange}
                        className="w-full rounded-lg border border-gray-300 px-4 py-3 text-sm outline-none focus:border-green-600 focus:ring-2 focus:ring-green-100"
                      >
                        <option value="DD/MM/YYYY">DD/MM/YYYY</option>
                        <option value="MM/DD/YYYY">MM/DD/YYYY</option>
                        <option value="YYYY-MM-DD">YYYY-MM-DD</option>
                      </select>
                    </div>

                    <SaveButton saved={saved} onClick={handleSave} />
                  </div>
                </div>
              )}
            </section>
          </div>
        </main>
      </div>
    </div>
  );
}

/* Password Input */
function PasswordInput({
  label,
  name,
  value,
  onChange,
  visible,
  setVisible,
}) {
  return (
    <div>
      <label className="mb-2 block text-sm font-medium text-gray-700">
        {label}
      </label>

      <div className="relative">
        <input
          type={visible ? "text" : "password"}
          name={name}
          value={value}
          onChange={onChange}
          className="w-full rounded-lg border border-gray-300 px-4 py-3 pr-12 text-sm outline-none focus:border-green-600 focus:ring-2 focus:ring-green-100"
        />

        <button
          type="button"
          onClick={() => setVisible(!visible)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700"
        >
          {visible ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </div>
    </div>
  );
}

/* Notification Toggle */
function NotificationToggle({
  name,
  title,
  description,
  checked,
  onChange,
}) {
  return (
    <div className="flex items-center justify-between gap-5 p-6">
      <div>
        <h3 className="text-sm font-semibold text-gray-900">
          {title}
        </h3>

        <p className="mt-1 text-sm text-gray-500">
          {description}
        </p>
      </div>

      <label className="relative inline-flex cursor-pointer items-center">
        <input
          type="checkbox"
          name={name}
          checked={checked}
          onChange={onChange}
          className="peer sr-only"
        />

        <div className="h-6 w-11 rounded-full bg-gray-300 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-green-700 peer-checked:after:translate-x-full peer-checked:after:border-white peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-green-100" />
      </label>
    </div>
  );
}

/* Save Button */
function SaveButton({ saved, onClick }) {
  return (
    <div className="flex items-center justify-between border-t border-gray-200 pt-5">
      {saved ? (
        <div className="flex items-center gap-2 text-sm font-medium text-green-700">
          <CheckCircle2 size={18} />
          Settings saved successfully.
        </div>
      ) : (
        <div />
      )}

      <button
        type="button"
        onClick={onClick}
        className="inline-flex items-center gap-2 rounded-lg bg-green-700 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-green-800"
      >
        <Save size={17} />
        Save Changes
      </button>
    </div>
  );
}

export default Settings;
