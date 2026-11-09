Pod::Spec.new do |s|
  s.name           = 'HealthStore'
  s.version        = '1.0.0'
  s.summary        = 'Step records in HealthKit (iOS side of the health-store module)'
  s.description    = s.summary
  s.license        = 'MIT'
  s.author         = 'stompers-faker'
  s.homepage       = 'https://github.com/syed-mohd-fasih/stompers-faker'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: 'https://github.com/syed-mohd-fasih/stompers-faker.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'HealthKit'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = "**/*.{h,m,swift}"
end
